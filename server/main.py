import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import async_session_factory, init_db
from exceptions import AppError, app_error_handler
from routers import admin as admin_router
from routers import auth as auth_router
from routers import calendar as calendar_router
from routers import chat as chat_router
from routers import notifications as notifications_router
from routers import search as search_router
from routers import settings as settings_router
from routers import tags as tags_router
from routers import tasks as tasks_router
from routers import today as today_router
from routers import task_relationship as task_relationship_router
from routers import attachment as attachment_router
from routers import obsidian as obsidian_router
from routers import pairing as pairing_router
from routers import todo as todo_router
from services.ai_service import AIService
from services.claude_code_provider import ClaudeCodeProvider, ClaudeCodeStatus, _find_claude_cli
from services.orchestrator import Orchestrator
from services.scheduler import Scheduler
from ws.handler import websocket_endpoint
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

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

    # Run slow startup checks concurrently instead of sequentially
    async def _check_ai() -> bool:
        return await ai_service.health_check()

    async def _check_claude_code():
        import subprocess as _sp
        cc = ClaudeCodeProvider()
        cli = _find_claude_cli()
        if not cli:
            return cc, ClaudeCodeStatus.NOT_INSTALLED, None
        cc._cli_path = cli
        try:
            result = _sp.run([cli, "--version"], capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                return cc, ClaudeCodeStatus.ERROR, None
            version = result.stdout.strip()
            return cc, ClaudeCodeStatus.AVAILABLE, version
        except Exception as e:
            logger.warning("Claude Code startup check failed: %s", e)
            return cc, ClaudeCodeStatus.ERROR, None

    async def _init_vault():
        if not settings.obsidian_vault_path:
            return
        try:
            from services.obsidian_cli_service import load_queue
            load_queue()
            logger.info("Obsidian CLI write queue loaded")
        except Exception:
            logger.debug("Could not load Obsidian CLI write queue")
        try:
            from services.obsidian_vault_indexer import refresh_index
            idx = await asyncio.to_thread(refresh_index)
            logger.info(
                "Obsidian vault index: %d projects (CLI=%s, companion=%s)",
                len(idx.projects),
                idx.cli_available,
                idx.companion_online,
            )
        except Exception:
            logger.debug("Could not build initial vault index")

    ai_connected, (claude_code, claude_code_status, claude_code_version), _ = (
        await asyncio.gather(_check_ai(), _check_claude_code(), _init_vault())
    )

    app.state.ai_connected = ai_connected
    app.state.claude_code = claude_code
    app.state.claude_code_status = claude_code_status.value
    app.state.claude_code_version = claude_code_version
    logger.info(f"Claude Code status: {claude_code_status.value}, version: {claude_code_version}")

    # Determine the active AI provider — Claude Code takes priority when
    # configured AND available; otherwise fall back to OpenClaw/OpenAI.
    if (
        settings.ai_provider == "claude_code"
        and claude_code_status == ClaudeCodeStatus.AVAILABLE
    ):
        app.state.active_ai = claude_code
        app.state.active_ai_provider = "claude_code"
        logger.info("Active AI provider: Claude Code CLI")
    else:
        app.state.active_ai = ai_service
        app.state.active_ai_provider = "openclaw"
        if settings.ai_provider == "claude_code":
            logger.warning(
                "ai_provider=claude_code but CLI is %s — falling back to OpenClaw",
                claude_code_status.value,
            )

    # Start background scheduler if enabled
    if settings.enable_scheduler:
        scheduler = Scheduler(
            session_factory=async_session_factory,
            ai_service=ai_service,
            ws_manager=ws_manager,
        )
        scheduler.start()
        app.state.scheduler = scheduler
        logger.info("Background scheduler started")
    else:
        app.state.scheduler = None

    yield

    # Stop scheduler before closing AI service
    if app.state.scheduler:
        await app.state.scheduler.stop()

    await ai_service.close()


app = FastAPI(title="ClawChat Server", version="0.1.0", lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(chat_router.router, prefix="/api/chat", tags=["chat"])
app.include_router(todo_router.router, prefix="/api/todos", tags=["todos"])
app.include_router(calendar_router.router, prefix="/api/events", tags=["calendar"])
app.include_router(search_router.router, prefix="/api/search", tags=["search"])
app.include_router(today_router.router, prefix="/api/today", tags=["today"])
app.include_router(notifications_router.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(tags_router.router, prefix="/api/tags", tags=["tags"])
app.include_router(tasks_router.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(task_relationship_router.router, prefix="/api/task-relationships", tags=["task-relationships"])
app.include_router(attachment_router.router, prefix="/api/attachments", tags=["attachments"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(obsidian_router.router, prefix="/api/obsidian", tags=["obsidian"])
app.include_router(pairing_router.router, prefix="/api/pairing", tags=["pairing"])

app.websocket("/ws")(websocket_endpoint)


@app.get("/api/health")
async def health():
    ai_connected = getattr(app.state, "ai_connected", False)
    active_provider = getattr(app.state, "active_ai_provider", "openclaw")
    claude_code_status = getattr(app.state, "claude_code_status", "unknown")
    # If Claude Code is the active provider, consider AI connected when CLI is available
    effective_connected = (
        ai_connected if active_provider == "openclaw"
        else claude_code_status == "available"
    )
    # Show the actual model name based on active provider
    ai_model = "claude (via CLI)" if active_provider == "claude_code" else settings.ai_model
    return {
        "status": "ok" if effective_connected else "degraded",
        "version": "0.1.0",
        "ai_provider": active_provider,
        "ai_model": ai_model,
        "ai_connected": effective_connected,
        "claude_code_status": claude_code_status,
        "claude_code_version": getattr(app.state, "claude_code_version", None),
    }
