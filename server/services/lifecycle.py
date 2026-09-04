"""Application startup helpers kept separate from the FastAPI wiring."""

import asyncio
import logging

from config import settings
from database import async_session_factory
from services.ai.ai_service import AIService
from services.ai.claude_code_provider import ClaudeCodeProvider, ClaudeCodeStatus
from services.ai.codex_api_provider import CodexAPIProvider, CodexAPIStatus
from services.ai.codex_cli_provider import CodexCLIProvider, CodexCLIStatus
from starlette.datastructures import State

logger = logging.getLogger(__name__)


async def initialize_host_identity(state: State) -> None:
    """Load the durable identity shared by health, pairing, and login."""
    from services.relay.host_identity import get_or_create_host_identity

    async with async_session_factory() as identity_db:
        identity = await get_or_create_host_identity(identity_db)
        await identity_db.commit()
        state.host_id = identity.host_id
        state.host_public_key = identity.public_key


# Aliases for the OpenAI-compatible relay, which is configured by base URL
# rather than by a provider of its own.
_OPENCLAW_ALIASES = {"ollama", "openai", "openclaw"}

# Tried in order when the configured provider is unreachable. The local relay
# comes before the Codex API so a self-hosted workspace is never pushed onto a
# metered backend while a working local one exists.
_FALLBACK_ORDER = ("claude_code", "codex_cli", "openclaw", "codex")


def select_active_provider(
    *,
    preferred: str,
    allow_fallback: bool,
    candidates: dict[str, tuple[object, bool]],
) -> tuple[str, object, bool]:
    """Pick the provider to serve chat, as ``(name, provider, fell_back)``.

    The configured provider always wins when it is reachable. Otherwise any
    other ready provider is used, so a host with only a CLI backend still has
    a working workspace instead of an unreachable OpenClaw relay.
    """
    name = preferred.strip().lower()
    if name in _OPENCLAW_ALIASES:
        name = "openclaw"
    elif name == "codex_api":
        name = "codex"
    if name not in candidates:
        name = "openclaw"

    provider, ready = candidates[name]
    if ready or not allow_fallback:
        return name, provider, False

    for fallback_name in _FALLBACK_ORDER:
        if fallback_name == name:
            continue
        fallback_provider, fallback_ready = candidates[fallback_name]
        if fallback_ready:
            return fallback_name, fallback_provider, True

    return name, provider, False


def configure_ai_state(
    state: State,
    *,
    ai_service: AIService,
    claude_code: ClaudeCodeProvider,
    codex_api: CodexAPIProvider,
    codex_cli: CodexCLIProvider,
) -> None:
    """Expose providers immediately while their optional probes run."""
    state.ai_connected = False
    state.claude_code = claude_code
    state.claude_code_status = "checking"
    state.claude_code_version = None
    state.codex_api = codex_api
    state.codex_api_status = (
        "checking" if codex_api.is_configured else CodexAPIStatus.NOT_CONFIGURED.value
    )
    state.codex_cli = codex_cli
    state.codex_cli_status = "checking"
    state.codex_cli_version = None
    state.active_ai = ai_service
    state.active_ai_provider = "openclaw"


async def probe_optional_ai(
    state: State,
    *,
    ai_service: AIService,
    claude_code: ClaudeCodeProvider,
    codex_api: CodexAPIProvider,
    codex_cli: CodexCLIProvider,
) -> None:
    """Probe optional providers concurrently and activate a working one."""

    async def check_codex_api() -> tuple[CodexAPIStatus, str]:
        # A result must not overwrite a credential configured while the other
        # optional provider probes were still running.
        credential_snapshot = codex_api.api_key
        return await codex_api.check_availability(), credential_snapshot

    try:
        (
            ai_connected,
            (claude_code_status, claude_code_version),
            (codex_api_status, codex_credential_snapshot),
            (codex_cli_status, codex_cli_version),
        ) = await asyncio.gather(
            ai_service.health_check(),
            # Both CLI providers run their blocking probes in worker threads.
            claude_code.check_availability(),
            check_codex_api(),
            codex_cli.check_availability(),
        )
        state.ai_connected = ai_connected
        state.claude_code_status = claude_code_status.value
        state.claude_code_version = claude_code_version
        state.codex_cli_status = codex_cli_status.value
        state.codex_cli_version = codex_cli_version
        codex_probe_is_current = codex_api.api_key == codex_credential_snapshot
        if codex_probe_is_current:
            state.codex_api_status = codex_api_status.value

        logger.info(
            "Claude Code status: %s, version: %s",
            claude_code_status.value,
            claude_code_version,
        )
        if codex_probe_is_current:
            logger.info(
                "Codex API status: %s, model: %s",
                codex_api_status.value,
                codex_api.model,
            )
        else:
            logger.info(
                "Discarded stale Codex API startup probe after configuration changed"
            )
        logger.info(
            "Codex CLI status: %s, version: %s",
            codex_cli_status.value,
            codex_cli_version,
        )

        provider_name, provider, fell_back = select_active_provider(
            preferred=settings.ai_provider,
            allow_fallback=settings.ai_provider_fallback,
            candidates={
                "openclaw": (ai_service, ai_connected),
                "claude_code": (
                    claude_code,
                    claude_code_status == ClaudeCodeStatus.AVAILABLE,
                ),
                "codex_cli": (
                    codex_cli,
                    codex_cli_status == CodexCLIStatus.AVAILABLE,
                ),
                "codex": (
                    codex_api,
                    codex_probe_is_current
                    and codex_api_status == CodexAPIStatus.AVAILABLE,
                ),
            },
        )
        state.active_ai = provider
        state.active_ai_provider = provider_name
        if fell_back:
            logger.warning(
                "ai_provider=%s is unavailable — using %s instead",
                settings.ai_provider,
                provider_name,
            )
        else:
            logger.info("Active AI provider: %s", provider_name)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Optional providers must never make the local task/calendar workspace
        # noisy or unusable during startup.
        logger.exception("Optional AI provider probe failed; continuing in local mode")


async def initialize_vault() -> None:
    """Restore the Vault index, CLI queue, and pending durable sync jobs."""
    if settings.obsidian_vault_path:
        try:
            from services.vault.obsidian_cli_service import load_queue

            await asyncio.to_thread(load_queue)
            logger.info("Obsidian CLI write queue loaded")
        except Exception:
            logger.debug("Could not load Obsidian CLI write queue")
        try:
            from services.vault.obsidian_vault_indexer import refresh_index

            index = await asyncio.to_thread(refresh_index)
            logger.info(
                "Obsidian vault index: %d projects (CLI=%s, companion=%s)",
                len(index.projects),
                index.cli_available,
                index.companion_online,
            )
        except Exception:
            logger.debug("Could not build initial vault index")

    try:
        from services.vault.vault_sync_service import process_pending_vault_sync_jobs

        async with async_session_factory() as vault_job_db:
            await process_pending_vault_sync_jobs(vault_job_db)
    except Exception:
        logger.exception("Could not resume pending Vault sync jobs")


async def vault_outbox_loop() -> None:
    """Continuously deliver pending Vault sync jobs."""
    from services.vault.vault_sync_service import process_pending_vault_sync_jobs

    while True:
        try:
            async with async_session_factory() as vault_job_db:
                await process_pending_vault_sync_jobs(vault_job_db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Periodic Vault outbox delivery failed")
        await asyncio.sleep(15)
