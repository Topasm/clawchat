import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from app_version import APP_VERSION
from config import settings
from database import async_session_factory, get_db, init_db
from exceptions import AppError, app_error_handler
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import admin as admin_router
from routers import agent_run as agent_run_router
from routers import attachment as attachment_router
from routers import artifact as artifact_router
from routers import auth as auth_router
from routers import calendar as calendar_router
from routers import capabilities as capabilities_router
from routers import change_set as change_set_router
from routers import chat as chat_router
from routers import execution_provider as execution_provider_router
from routers import notifications as notifications_router
from routers import obsidian as obsidian_router
from routers import pairing as pairing_router
from routers import project as project_router
from routers import review as review_router
from routers import search as search_router
from routers import settings as settings_router
from routers import task_relationship as task_relationship_router
from routers import tasks as tasks_router
from routers import today as today_router
from routers import todo as todo_router
from routers import voice as voice_router
from services.ai.ai_service import AIService
from services.ai.claude_code_provider import (
    ClaudeCodeProvider,
    ClaudeCodeStatus,
)
from services.ai.codex_api_provider import CodexAPIProvider, CodexAPIStatus
from services.ai.codex_cli_provider import CodexCLIProvider, CodexCLIStatus
from services.chat.orchestrator import Orchestrator
from services.scheduler import Scheduler
from sqlalchemy.ext.asyncio import AsyncSession
from utils.access_log import install_access_log_redaction
from ws.handler import websocket_endpoint
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The calendar feed authenticates by URL, so the access log would
    # otherwise record a working credential on every poll.
    install_access_log_redaction()

    await init_db()

    # Expose the same durable identity through health, pairing, and login so a
    # saved workspace cannot silently turn into a different server at the same
    # URL.
    from services.relay.host_identity import get_or_create_host_identity

    async with async_session_factory() as identity_db:
        identity = await get_or_create_host_identity(identity_db)
        await identity_db.commit()
        app.state.host_id = identity.host_id
        app.state.host_public_key = identity.public_key

    # Create AI service — relays to OpenClaw
    ai_service = AIService(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
    )
    app.state.ai_service = ai_service

    # Create orchestrator (receives app_state so it can resolve the active AI provider at runtime)
    app.state.orchestrator = Orchestrator(
        ai_service=ai_service,
        ws_manager=ws_manager,
        session_factory=async_session_factory,
        app_state=app.state,
    )

    app.state.session_factory = async_session_factory

    from services.agents import paseo_execution_service

    app.state.paseo_adapter = paseo_execution_service.adapter_from_settings()

    # Run slow startup checks concurrently instead of sequentially
    async def _check_ai() -> bool:
        return await ai_service.health_check()

    claude_code = ClaudeCodeProvider()
    codex_cli = CodexCLIProvider(model=settings.codex_cli_model)
    codex_api = CodexAPIProvider(
        api_key=settings.codex_api_key,
        model=settings.codex_model,
        base_url=settings.codex_api_base_url,
        reasoning_effort=settings.codex_reasoning_effort,
    )

    async def _check_claude_code():
        # check_availability() already runs the CLI probe through asyncio.to_thread
        # and resolves _cli_path itself; calling subprocess.run here would stall the
        # event loop for up to 10s during startup.
        status, version = await claude_code.check_availability()
        return status, version

    async def _check_codex_api() -> tuple[CodexAPIStatus, str]:
        # Keep the credential snapshot private, but return it so a startup
        # result cannot overwrite a key the user configured while the other
        # optional provider probes were still running.
        credential_snapshot = codex_api.api_key
        return await codex_api.check_availability(), credential_snapshot

    async def _check_codex_cli():
        return await codex_cli.check_availability()

    async def _init_vault():
        if settings.obsidian_vault_path:
            try:
                from services.vault.obsidian_cli_service import load_queue
                await asyncio.to_thread(load_queue)
                logger.info("Obsidian CLI write queue loaded")
            except Exception:
                logger.debug("Could not load Obsidian CLI write queue")
            try:
                from services.vault.obsidian_vault_indexer import refresh_index
                idx = await asyncio.to_thread(refresh_index)
                logger.info(
                    "Obsidian vault index: %d projects (CLI=%s, companion=%s)",
                    len(idx.projects),
                    idx.cli_available,
                    idx.companion_online,
                )
            except Exception:
                logger.debug("Could not build initial vault index")
        try:
            from services.vault.vault_sync_service import process_pending_vault_sync_jobs

            async with async_session_factory() as vault_job_db:
                await process_pending_vault_sync_jobs(vault_job_db)
        except Exception:
            logger.exception("Could not resume pending Vault sync jobs")

    # Task and calendar storage are the core desktop product. Optional AI
    # probes can each wait on unavailable local tools for several seconds, so
    # they must not delay the health endpoint that unlocks the local workspace.
    app.state.ai_connected = False
    app.state.claude_code = claude_code
    app.state.claude_code_status = "checking"
    app.state.claude_code_version = None
    app.state.codex_api = codex_api
    app.state.codex_api_status = (
        "checking" if codex_api.is_configured else CodexAPIStatus.NOT_CONFIGURED.value
    )
    app.state.codex_cli = codex_cli
    app.state.codex_cli_status = "checking"
    app.state.codex_cli_version = None
    app.state.active_ai = ai_service
    app.state.active_ai_provider = "openclaw"

    async def _probe_optional_ai() -> None:
        try:
            (
                ai_connected,
                (claude_code_status, claude_code_version),
                (codex_api_status, codex_credential_snapshot),
                (codex_cli_status, codex_cli_version),
            ) = await asyncio.gather(
                _check_ai(),
                _check_claude_code(),
                _check_codex_api(),
                _check_codex_cli(),
            )
            app.state.ai_connected = ai_connected
            app.state.claude_code_status = claude_code_status.value
            app.state.claude_code_version = claude_code_version
            app.state.codex_cli_status = codex_cli_status.value
            app.state.codex_cli_version = codex_cli_version
            codex_probe_is_current = (
                codex_api.api_key == codex_credential_snapshot
            )
            if codex_probe_is_current:
                app.state.codex_api_status = codex_api_status.value
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
                app.state.active_ai = claude_code
                app.state.active_ai_provider = "claude_code"
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
                app.state.active_ai = codex_cli
                app.state.active_ai_provider = "codex_cli"
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
                app.state.active_ai = codex_api
                app.state.active_ai_provider = "codex"
                logger.info("Active AI provider: Codex API (%s)", codex_api.model)
            elif (
                settings.ai_provider in {"codex", "codex_api"}
                and codex_probe_is_current
            ):
                logger.warning(
                    "ai_provider=codex but the API is %s — falling back to OpenClaw",
                    codex_api_status.value,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            # Optional providers must never make the local task/calendar
            # workspace noisy or unusable during startup.
            logger.exception("Optional AI provider probe failed; continuing in local mode")

    app.state.ai_probe_task = asyncio.create_task(
        _probe_optional_ai(),
        name="optional-ai-probe",
    )

    # Vault recovery remains part of durable-data startup, but it does not
    # contact an AI provider or require a remote server.
    await _init_vault()

    # Initialize push notification service (no-op if not configured)
    from services.notifications.push_service import PushService
    push_service = PushService(settings.firebase_credentials_path)
    app.state.push_service = push_service

    recovered_paseo_runs = await paseo_execution_service.recover_active_runs(
        async_session_factory,
        adapter=app.state.paseo_adapter,
    )
    if recovered_paseo_runs:
        logger.info("Reattached %d Paseo AgentRun monitor(s)", recovered_paseo_runs)

    # Start background scheduler if enabled
    if settings.enable_scheduler:
        scheduler = Scheduler(
            session_factory=async_session_factory,
            ai_service=ai_service,
            ws_manager=ws_manager,
            push_service=push_service,
            app_state=app.state,
        )
        scheduler.start()
        app.state.scheduler = scheduler
        logger.info("Background scheduler started")
    else:
        app.state.scheduler = None

    async def _vault_outbox_loop() -> None:
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

    # Outbox recovery is independent of the optional feature scheduler. This
    # also resolves jobs as succeeded when no Vault is configured.
    app.state.vault_outbox_task = asyncio.create_task(
        _vault_outbox_loop(),
        name="vault-outbox",
    )

    # The host initiates the relay connection outbound, so no inbound port or
    # firewall change is needed. An empty RELAY_URL keeps LAN-only behavior.
    app.state.relay_connector = None
    app.state.relay_task = None
    if settings.relay_url:
        from services.relay.relay_connector import RelayHostConnector

        relay_connector = RelayHostConnector(settings.relay_url, settings.port, ws_manager)
        app.state.relay_connector = relay_connector
        app.state.relay_task = asyncio.create_task(relay_connector.run_forever())

    yield

    # Stop scheduler before closing AI service
    if app.state.scheduler:
        await app.state.scheduler.stop()

    app.state.vault_outbox_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.vault_outbox_task

    if app.state.relay_connector:
        await app.state.relay_connector.stop()
    if app.state.relay_task:
        app.state.relay_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.relay_task

    if not app.state.ai_probe_task.done():
        app.state.ai_probe_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.ai_probe_task

    await ai_service.close()
    await codex_api.close()


app = FastAPI(title="ClawChat Server", version=APP_VERSION, lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)

_cors_origins = settings.resolved_cors_origins()
# A wildcard origin and credentialed requests are mutually exclusive per the
# CORS spec -- browsers reject the combination -- so the wildcard mode drops
# credentials rather than emitting a header pair no browser will honour.
_cors_allow_credentials = _cors_origins != ["*"]
if _cors_origins == ["*"]:
    logger.warning(
        "CORS_ALLOW_ORIGINS is '*': any website can call this server's API "
        "from a browser. Set an explicit origin list for any exposed deployment."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(agent_run_router.router, prefix="/api/runs", tags=["runs"])
app.include_router(chat_router.router, prefix="/api/chat", tags=["chat"])
app.include_router(todo_router.router, prefix="/api/todos", tags=["todos"])
app.include_router(project_router.router, prefix="/api/projects", tags=["projects"])
app.include_router(
    execution_provider_router.router,
    prefix="/api/execution-providers",
    tags=["execution-providers"],
)
app.include_router(artifact_router.router, prefix="/api", tags=["artifacts"])
app.include_router(review_router.router, prefix="/api/reviews", tags=["reviews"])
app.include_router(
    change_set_router.router,
    prefix="/api/change-sets",
    tags=["change-sets"],
)
app.include_router(
    task_relationship_router.router,
    prefix="/api/task-relationships",
    tags=["task-relationships"],
)
app.include_router(calendar_router.router, prefix="/api/events", tags=["calendar"])
app.include_router(search_router.router, prefix="/api/search", tags=["search"])
app.include_router(today_router.router, prefix="/api/today", tags=["today"])
app.include_router(notifications_router.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(tasks_router.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(attachment_router.router, prefix="/api/attachments", tags=["attachments"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(obsidian_router.router, prefix="/api/obsidian", tags=["obsidian"])
app.include_router(pairing_router.router, prefix="/api/pairing", tags=["pairing"])
app.include_router(capabilities_router.router, prefix="/api/capabilities", tags=["capabilities"])
app.include_router(voice_router.router, prefix="/api/voice", tags=["voice"])

app.websocket("/ws")(websocket_endpoint)


@app.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    host_id = getattr(app.state, "host_id", None)
    host_public_key = getattr(app.state, "host_public_key", None)
    if not host_id:
        from services.relay.host_identity import get_or_create_host_identity

        identity = await get_or_create_host_identity(db)
        await db.commit()
        host_id = identity.host_id
        host_public_key = identity.public_key
        app.state.host_id = host_id
        app.state.host_public_key = host_public_key
    ai_connected = getattr(app.state, "ai_connected", False)
    active_provider = getattr(app.state, "active_ai_provider", "openclaw")
    claude_code_status = getattr(app.state, "claude_code_status", "unknown")
    codex_api_status = getattr(app.state, "codex_api_status", "unknown")
    codex_cli_status = getattr(app.state, "codex_cli_status", "unknown")
    if active_provider == "claude_code":
        effective_connected = claude_code_status == "available"
        ai_model = "claude (via CLI)"
    elif active_provider == "codex":
        effective_connected = codex_api_status == "available"
        ai_model = settings.codex_model
    elif active_provider == "codex_cli":
        effective_connected = codex_cli_status == "available"
        ai_model = settings.codex_cli_model or "Codex CLI default"
    else:
        effective_connected = ai_connected
        ai_model = settings.ai_model
    return {
        # The desktop shell uses this marker before reusing a process that is
        # already listening on its configured port. A generic HTTP 200 is not
        # enough: port 8000 is commonly occupied by unrelated developer tools.
        "service": "clawchat",
        "api_version": "1",
        "host_id": host_id,
        "host_public_key": host_public_key,
        "status": "ok" if effective_connected else "degraded",
        "version": APP_VERSION,
        "ai_provider": active_provider,
        "ai_model": ai_model,
        "ai_connected": effective_connected,
        "claude_code_status": claude_code_status,
        "claude_code_version": getattr(app.state, "claude_code_version", None),
        "codex_api_status": codex_api_status,
        "codex_model": settings.codex_model,
        "codex_cli_status": codex_cli_status,
        "codex_cli_version": getattr(app.state, "codex_cli_version", None),
        "codex_cli_model": settings.codex_cli_model,
    }
