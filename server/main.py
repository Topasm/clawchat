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
from routers import execution_host as execution_host_router
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
from services.ai.claude_code_provider import ClaudeCodeProvider
from services.ai.codex_api_provider import CodexAPIProvider
from services.ai.codex_cli_provider import CodexCLIProvider
from services.chat.orchestrator import Orchestrator
from services.lifecycle import (
    configure_ai_state,
    initialize_host_identity,
    initialize_vault,
    probe_optional_ai,
    vault_outbox_loop,
)
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

    # Expose the same durable identity through health, pairing, and login.
    await initialize_host_identity(app.state)

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

    claude_code = ClaudeCodeProvider(model=settings.claude_code_model)
    codex_cli = CodexCLIProvider(model=settings.codex_cli_model)
    codex_api = CodexAPIProvider(
        api_key=settings.codex_api_key,
        model=settings.codex_model,
        base_url=settings.codex_api_base_url,
        reasoning_effort=settings.codex_reasoning_effort,
    )

    # Task and calendar storage are the core desktop product. Optional AI
    # probes can each wait on unavailable local tools for several seconds, so
    # they must not delay the health endpoint that unlocks the local workspace.
    configure_ai_state(
        app.state,
        ai_service=ai_service,
        claude_code=claude_code,
        codex_api=codex_api,
        codex_cli=codex_cli,
    )

    app.state.ai_probe_task = asyncio.create_task(
        probe_optional_ai(
            app.state,
            ai_service=ai_service,
            claude_code=claude_code,
            codex_api=codex_api,
            codex_cli=codex_cli,
        ),
        name="optional-ai-probe",
    )

    # Vault recovery remains part of durable-data startup, but it does not
    # contact an AI provider or require a remote server.
    await initialize_vault()

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

    # Outbox recovery is independent of the optional feature scheduler. This
    # also resolves jobs as succeeded when no Vault is configured.
    app.state.vault_outbox_task = asyncio.create_task(
        vault_outbox_loop(),
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
    execution_host_router.router,
    prefix="/api/execution-hosts",
    tags=["execution-hosts"],
)
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
        ai_model = f"claude {settings.claude_code_model or 'default'} (via CLI)"
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
        "claude_code_model": settings.claude_code_model,
        "codex_api_status": codex_api_status,
        "codex_model": settings.codex_model,
        "codex_cli_status": codex_cli_status,
        "codex_cli_version": getattr(app.state, "codex_cli_version", None),
        "codex_cli_model": settings.codex_cli_model,
    }
