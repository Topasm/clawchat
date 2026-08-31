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
    """Probe optional providers concurrently and select the configured one."""

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

        if (
            settings.ai_provider == "claude_code"
            and claude_code_status == ClaudeCodeStatus.AVAILABLE
        ):
            state.active_ai = claude_code
            state.active_ai_provider = "claude_code"
            logger.info("Active AI provider: Claude Code CLI")
        elif settings.ai_provider == "claude_code":
            logger.warning(
                "ai_provider=claude_code but CLI is %s — falling back to OpenClaw",
                claude_code_status.value,
            )
        elif (
            settings.ai_provider == "codex_cli"
            and codex_cli_status == CodexCLIStatus.AVAILABLE
        ):
            state.active_ai = codex_cli
            state.active_ai_provider = "codex_cli"
            logger.info("Active AI provider: Codex CLI")
        elif settings.ai_provider == "codex_cli":
            logger.warning(
                "ai_provider=codex_cli but the CLI is %s — falling back to OpenClaw",
                codex_cli_status.value,
            )
        elif (
            settings.ai_provider in {"codex", "codex_api"}
            and codex_probe_is_current
            and codex_api_status == CodexAPIStatus.AVAILABLE
        ):
            state.active_ai = codex_api
            state.active_ai_provider = "codex"
            logger.info("Active AI provider: Codex API (%s)", codex_api.model)
        elif settings.ai_provider in {"codex", "codex_api"} and codex_probe_is_current:
            logger.warning(
                "ai_provider=codex but the API is %s — falling back to OpenClaw",
                codex_api_status.value,
            )
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
