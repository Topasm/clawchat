"""Admin dashboard endpoints."""

import time
import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app_version import APP_VERSION
from auth.dependencies import get_current_user
from config import AI_PROVIDERS, save_ai_provider, save_codex_api_key, settings
from database import get_db
from exceptions import ValidationError
from schemas.admin import (
    AdminOverviewResponse,
    ServerOverview,
    TableCounts,
    StorageStats,
    AIConfigResponse,
    AITestResponse,
    ActivityResponse,
    RecentActivity,
    AgentTaskSummary,
    SessionsResponse,
    ActiveSession,
    ServerConfigResponse,
    DataOverviewResponse,
    ModuleDataOverview,
    PurgeRequest,
    PurgeResponse,
    ReindexResponse,
    BackupResponse,
    ClaudeCodeStatusResponse,
    CodexCLIStatusResponse,
    CodexAPIConfigRequest,
    CodexAPIStatusResponse,
    AIProviderResponse,
    SwitchProviderRequest,
)
from services import admin_service
from services.ai.codex_api_provider import CodexAPIStatus
from services.ai.codex_cli_provider import CodexCLIStatus
from ws.manager import ws_manager
from ws.notifications import notify_module_data_changed

logger = logging.getLogger(__name__)

router = APIRouter()


def _active_provider_summary(request: Request) -> tuple[str, str, str, bool]:
    state = request.app.state
    active_provider = getattr(state, "active_ai_provider", "openclaw")
    if active_provider == "claude_code":
        claude_code = getattr(state, "claude_code", None)
        claude_model = getattr(claude_code, "model", settings.claude_code_model)
        return (
            active_provider,
            f"claude {claude_model or 'default'} (via CLI)",
            "local CLI",
            getattr(state, "claude_code_status", "") == "available",
        )
    if active_provider == "codex":
        codex = getattr(state, "codex_api", None)
        return (
            active_provider,
            getattr(codex, "model", settings.codex_model),
            getattr(codex, "base_url", settings.codex_api_base_url),
            getattr(state, "codex_api_status", "") == "available",
        )
    if active_provider == "codex_cli":
        codex_cli = getattr(state, "codex_cli", None)
        return (
            active_provider,
            getattr(codex_cli, "model", "") or "Codex CLI default",
            "local CLI",
            getattr(state, "codex_cli_status", "") == "available",
        )
    return (
        "openclaw",
        settings.ai_model,
        settings.ai_base_url,
        getattr(state, "ai_connected", False),
    )


def _remember_provider(provider: str) -> None:
    """Keep an in-app provider switch across restarts.

    The switch itself has already taken effect, so a workspace whose data
    directory is read-only stays on the new provider for this session rather
    than failing the request.
    """
    settings.ai_provider = provider
    if not settings.ai_provider_file:
        return
    try:
        save_ai_provider(settings.ai_provider_file, provider)
    except (OSError, ValueError):
        logger.exception("Could not persist the active AI provider")


def _provider_response(request: Request) -> AIProviderResponse:
    state = request.app.state
    codex = getattr(state, "codex_api", None)
    return AIProviderResponse(
        active_provider=getattr(state, "active_ai_provider", "openclaw"),
        openclaw_connected=getattr(state, "ai_connected", False),
        claude_code_status=getattr(state, "claude_code_status", "unknown"),
        claude_code_version=getattr(state, "claude_code_version", None),
        codex_cli_status=getattr(state, "codex_cli_status", "unknown"),
        codex_cli_version=getattr(state, "codex_cli_version", None),
        codex_cli_model=getattr(getattr(state, "codex_cli", None), "model", ""),
        codex_api_status=getattr(state, "codex_api_status", "not_configured"),
        codex_api_configured=bool(codex and codex.is_configured),
        codex_api_key_persistent=bool(settings.codex_api_key_file),
        codex_model=getattr(codex, "model", settings.codex_model),
    )


# --- Overview ---


@router.get("/overview", response_model=AdminOverviewResponse)
async def get_overview(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    counts_dict = await admin_service.get_table_counts(db)
    storage_dict = await admin_service.get_storage_stats(db)

    scheduler = getattr(request.app.state, "scheduler", None)

    active_provider, ai_model, ai_base_url, ai_connected = _active_provider_summary(
        request
    )

    server = ServerOverview(
        uptime_seconds=admin_service.get_uptime_seconds(),
        version=APP_VERSION,
        ai_backend=active_provider,
        ai_model=ai_model,
        ai_base_url=ai_base_url,
        ai_connected=ai_connected,
        active_ws_connections=len(ws_manager.active_connections),
        scheduler_enabled=settings.enable_scheduler,
        scheduler_running=scheduler is not None,
    )

    return AdminOverviewResponse(
        server=server,
        counts=TableCounts(**counts_dict),
        storage=StorageStats(**storage_dict),
    )


# --- AI Configuration ---


@router.get("/ai", response_model=AIConfigResponse)
async def get_ai_config(
    request: Request,
    _user: str = Depends(get_current_user),
):
    active_provider, model, base_url, _ = _active_provider_summary(request)
    ai_service = getattr(request.app.state, "active_ai", None) or getattr(
        request.app.state, "ai_service"
    )
    connected = await ai_service.health_check()
    if active_provider == "openclaw":
        request.app.state.ai_connected = connected
    elif active_provider == "codex":
        request.app.state.codex_api_status = "available" if connected else "unavailable"
    elif active_provider == "codex_cli":
        request.app.state.codex_cli_status = "available" if connected else "error"

    models: list[str] = []
    if connected and active_provider == "openclaw":
        try:
            resp = await ai_service.client.get(
                f"{ai_service.base_url}/v1/models", timeout=5.0
            )
            if resp.status_code == 200:
                data = resp.json()
                models = [m["id"] for m in data.get("data", [])]
        except Exception:
            pass
    elif connected:
        models = [model]

    return AIConfigResponse(
        backend=active_provider,
        model=model,
        base_url=base_url,
        connected=connected,
        available_models=models,
    )


@router.post("/ai/test", response_model=AITestResponse)
async def test_ai_connection(
    request: Request,
    _user: str = Depends(get_current_user),
):
    active_provider = getattr(request.app.state, "active_ai_provider", "openclaw")
    ai_service = getattr(request.app.state, "active_ai", None) or getattr(
        request.app.state, "ai_service"
    )
    start = time.time()
    try:
        connected = await ai_service.health_check()
        latency = (time.time() - start) * 1000
        if active_provider == "openclaw":
            request.app.state.ai_connected = connected
        elif active_provider == "codex":
            request.app.state.codex_api_status = (
                "available" if connected else "unavailable"
            )
        elif active_provider == "codex_cli":
            request.app.state.codex_cli_status = "available" if connected else "error"
        return AITestResponse(
            connected=connected,
            latency_ms=round(latency, 1) if connected else None,
            error=None if connected else "Health check returned false",
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return AITestResponse(connected=False, latency_ms=round(latency, 1), error=str(exc))


# --- Activity & Logs ---


@router.get("/activity", response_model=ActivityResponse)
async def get_activity(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    recent = await admin_service.get_recent_activity(db, limit=50)
    agent_tasks = await admin_service.get_agent_task_history(db, limit=50)
    return ActivityResponse(
        recent=[RecentActivity(**r) for r in recent],
        agent_tasks=[AgentTaskSummary(**t) for t in agent_tasks],
    )


# --- Sessions ---


@router.get("/sessions", response_model=SessionsResponse)
async def get_sessions(
    _user: str = Depends(get_current_user),
):
    connections = [
        ActiveSession(user_id=uid, connected=True)
        for uid in ws_manager.active_connections
    ]
    return SessionsResponse(
        active_connections=connections,
        total_connections=len(connections),
    )


@router.post("/sessions/{user_id}/disconnect")
async def disconnect_session(
    user_id: str,
    _user: str = Depends(get_current_user),
):
    ws = ws_manager.active_connections.get(user_id)
    if ws:
        await ws.close()
        ws_manager.disconnect(user_id)
        return {"status": "disconnected", "user_id": user_id}
    return {"status": "not_found", "user_id": user_id}


# --- Server Config ---


@router.get("/config", response_model=ServerConfigResponse)
async def get_server_config(
    _user: str = Depends(get_current_user),
):
    db_display = settings.database_url.split("///")[-1] if "///" in settings.database_url else "***"
    configured_provider = settings.ai_provider
    if configured_provider in {"codex", "codex_api"}:
        ai_backend = "codex"
        ai_base_url = settings.codex_api_base_url
        ai_model = settings.codex_model
    elif configured_provider == "claude_code":
        ai_backend = "claude_code"
        ai_base_url = "local CLI"
        ai_model = f"claude {settings.claude_code_model or 'default'} (via CLI)"
    elif configured_provider == "codex_cli":
        ai_backend = "codex_cli"
        ai_base_url = "local CLI"
        ai_model = settings.codex_cli_model or "Codex CLI default"
    else:
        ai_backend = "openclaw"
        ai_base_url = settings.ai_base_url
        ai_model = settings.ai_model
    return ServerConfigResponse(
        host=settings.host,
        port=settings.port,
        database_url=db_display,
        jwt_expiry_hours=settings.jwt_expiry_hours,
        ai_backend=ai_backend,
        ai_base_url=ai_base_url,
        ai_model=ai_model,
        upload_dir=settings.upload_dir,
        max_upload_size_mb=settings.max_upload_size_mb,
        allowed_extensions=settings.allowed_extensions,
        enable_scheduler=settings.enable_scheduler,
        briefing_time=settings.briefing_time,
        reminder_check_interval=settings.reminder_check_interval,
        debug=settings.debug,
    )


# --- Data Management ---


@router.get("/data", response_model=DataOverviewResponse)
async def get_data_overview(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    modules = await admin_service.get_module_data_overview(db)
    return DataOverviewResponse(
        modules=[ModuleDataOverview(**m) for m in modules]
    )


# --- Database Operations ---


@router.post("/db/reindex", response_model=ReindexResponse)
async def reindex_database(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    tables = await admin_service.reindex_fts(db)
    return ReindexResponse(status="completed", tables_reindexed=tables)


@router.post("/db/backup", response_model=BackupResponse)
async def backup_database(
    _user: str = Depends(get_current_user),
):
    filename, size = await admin_service.backup_database()
    return BackupResponse(filename=filename, size_bytes=size)


@router.post("/db/purge", response_model=PurgeResponse)
async def purge_data(
    body: PurgeRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    if body.target not in ("conversations", "messages", "todos"):
        raise ValidationError(f"Invalid purge target: {body.target}")
    if body.older_than_days < 1:
        raise ValidationError("older_than_days must be >= 1")

    count = await admin_service.purge_old_data(db, body.target, body.older_than_days)
    if body.target == "todos" and count > 0:
        await notify_module_data_changed("todos")
    return PurgeResponse(deleted_count=count, target=body.target)


# --- AI Provider Management ---


@router.get("/ai/provider", response_model=AIProviderResponse)
async def get_ai_provider(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Get current AI provider status and which one is active."""
    return _provider_response(request)


@router.post("/ai/provider", response_model=AIProviderResponse)
async def switch_ai_provider(
    body: SwitchProviderRequest,
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Switch between AI providers at runtime."""
    if body.provider not in AI_PROVIDERS:
        raise ValidationError(
            f"Invalid provider: {body.provider}. "
            "Use 'openclaw', 'claude_code', 'codex_cli', or 'codex'.",
            details={"reason": "invalid_provider"},
        )

    if body.provider == "claude_code":
        claude_code = getattr(request.app.state, "claude_code", None)
        if not claude_code:
            raise ValidationError(
                "Claude Code provider not initialized.",
                details={"reason": "claude_not_initialized"},
            )
        # Re-check availability
        from services.ai.claude_code_provider import ClaudeCodeStatus
        status, version = await claude_code.check_availability()
        request.app.state.claude_code_status = status.value
        request.app.state.claude_code_version = version
        if status != ClaudeCodeStatus.AVAILABLE:
            raise ValidationError(
                f"Claude Code is not available (status: {status.value}). "
                "Make sure it's installed and authenticated.",
                details={
                    "reason": "claude_unavailable",
                    "provider_status": status.value,
                },
            )
        request.app.state.active_ai = claude_code
        request.app.state.active_ai_provider = "claude_code"
        logger.info("Switched active AI provider to Claude Code")
    elif body.provider == "codex_cli":
        codex_cli = getattr(request.app.state, "codex_cli", None)
        if not codex_cli:
            raise ValidationError(
                "Codex CLI provider not initialized.",
                details={"reason": "codex_cli_not_initialized"},
            )
        status, version = await codex_cli.check_availability()
        request.app.state.codex_cli_status = status.value
        request.app.state.codex_cli_version = version
        if status != CodexCLIStatus.AVAILABLE:
            raise ValidationError(
                "Codex CLI is unavailable. Install it and run `codex login`.",
                details={
                    "reason": "codex_cli_unavailable",
                    "provider_status": status.value,
                },
            )
        request.app.state.active_ai = codex_cli
        request.app.state.active_ai_provider = "codex_cli"
        logger.info("Switched active AI provider to Codex CLI")
    elif body.provider == "codex":
        codex_api = getattr(request.app.state, "codex_api", None)
        if not codex_api:
            raise ValidationError(
                "Codex API provider not initialized.",
                details={"reason": "codex_not_initialized"},
            )
        status = await codex_api.check_availability()
        request.app.state.codex_api_status = status.value
        if status != CodexAPIStatus.AVAILABLE:
            if status == CodexAPIStatus.NOT_CONFIGURED:
                message = "Configure an OpenAI API key before using Codex."
                reason = "codex_not_configured"
            elif status == CodexAPIStatus.AUTHENTICATION_FAILED:
                message = "The configured OpenAI API key was rejected."
                reason = "codex_authentication_failed"
            else:
                message = "The Codex API or configured model is unavailable."
                reason = "codex_unavailable"
            raise ValidationError(message, details={"reason": reason})
        request.app.state.active_ai = codex_api
        request.app.state.active_ai_provider = "codex"
        logger.info("Switched active AI provider to Codex API (%s)", codex_api.model)
    else:
        request.app.state.active_ai = request.app.state.ai_service
        request.app.state.active_ai_provider = "openclaw"
        logger.info("Switched active AI provider to OpenClaw")

    _remember_provider(body.provider)
    return _provider_response(request)


@router.put("/ai/codex", response_model=AIProviderResponse)
async def configure_codex_api(
    body: CodexAPIConfigRequest,
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Validate, securely persist when possible, and activate a Codex API key."""
    codex_api = getattr(request.app.state, "codex_api", None)
    if not codex_api:
        raise ValidationError(
            "Codex API provider not initialized.",
            details={"reason": "codex_not_initialized"},
        )

    api_key = body.api_key.get_secret_value().strip()
    if len(api_key) < 32:
        raise ValidationError(
            "OpenAI API key is empty or too short.",
            details={"reason": "codex_key_too_short"},
        )

    previous_key = codex_api.api_key
    previous_status = getattr(
        request.app.state, "codex_api_status", CodexAPIStatus.NOT_CONFIGURED.value
    )
    codex_api.set_api_key(api_key)
    status = await codex_api.check_availability()
    if status != CodexAPIStatus.AVAILABLE:
        codex_api.set_api_key(previous_key)
        request.app.state.codex_api_status = previous_status
        if status == CodexAPIStatus.AUTHENTICATION_FAILED:
            raise ValidationError(
                "OpenAI rejected this API key.",
                details={"reason": "codex_authentication_failed"},
            )
        raise ValidationError(
            "Could not access the configured Codex model. Check the network and model access.",
            details={"reason": "codex_model_unavailable"},
        )

    if settings.codex_api_key_file:
        try:
            save_codex_api_key(settings.codex_api_key_file, api_key)
        except (OSError, ValueError):
            codex_api.set_api_key(previous_key)
            request.app.state.codex_api_status = previous_status
            logger.exception("Could not persist the Codex API key")
            raise ValidationError(
                "Could not securely save the OpenAI API key.",
                details={"reason": "codex_key_persist_failed"},
            )

    settings.codex_api_key = api_key
    request.app.state.codex_api_status = CodexAPIStatus.AVAILABLE.value
    request.app.state.active_ai = codex_api
    request.app.state.active_ai_provider = "codex"
    _remember_provider("codex")
    logger.info(
        "Configured and activated Codex API (%s, persistent=%s)",
        codex_api.model,
        bool(settings.codex_api_key_file),
    )
    return _provider_response(request)


@router.post("/ai/codex/check", response_model=CodexAPIStatusResponse)
async def recheck_codex_api(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Re-check OpenAI credentials and access to the configured Codex model."""
    codex_api = getattr(request.app.state, "codex_api", None)
    if not codex_api:
        raise ValidationError(
            "Codex API provider not initialized.",
            details={"reason": "codex_not_initialized"},
        )
    status = await codex_api.check_availability()
    request.app.state.codex_api_status = status.value
    return CodexAPIStatusResponse(
        status=status.value,
        configured=codex_api.is_configured,
        model=codex_api.model,
        active=getattr(request.app.state, "active_ai_provider", "openclaw")
        == "codex",
    )


@router.get("/ai/claude-code", response_model=ClaudeCodeStatusResponse)
async def get_claude_code_status(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Get Claude Code CLI status and version."""
    return ClaudeCodeStatusResponse(
        status=getattr(request.app.state, "claude_code_status", "unknown"),
        version=getattr(request.app.state, "claude_code_version", None),
        active=getattr(request.app.state, "active_ai_provider", "openclaw") == "claude_code",
    )


@router.get("/ai/codex-cli", response_model=CodexCLIStatusResponse)
async def get_codex_cli_status(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Get local Codex CLI install and login status."""
    codex_cli = getattr(request.app.state, "codex_cli", None)
    return CodexCLIStatusResponse(
        status=getattr(request.app.state, "codex_cli_status", "unknown"),
        version=getattr(request.app.state, "codex_cli_version", None),
        model=getattr(codex_cli, "model", ""),
        active=getattr(request.app.state, "active_ai_provider", "openclaw")
        == "codex_cli",
    )


@router.post("/ai/codex-cli/check", response_model=CodexCLIStatusResponse)
async def recheck_codex_cli(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Re-check the local Codex CLI and saved login."""
    codex_cli = getattr(request.app.state, "codex_cli", None)
    if not codex_cli:
        from services.ai.codex_cli_provider import CodexCLIProvider

        codex_cli = CodexCLIProvider(model=settings.codex_cli_model)
        request.app.state.codex_cli = codex_cli
    status, version = await codex_cli.check_availability()
    request.app.state.codex_cli_status = status.value
    request.app.state.codex_cli_version = version
    return CodexCLIStatusResponse(
        status=status.value,
        version=version,
        model=codex_cli.model,
        active=getattr(request.app.state, "active_ai_provider", "openclaw")
        == "codex_cli",
    )


@router.post("/ai/claude-code/check", response_model=ClaudeCodeStatusResponse)
async def recheck_claude_code(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Re-check Claude Code CLI availability."""
    claude_code = getattr(request.app.state, "claude_code", None)
    if not claude_code:
        from services.ai.claude_code_provider import ClaudeCodeProvider
        claude_code = ClaudeCodeProvider(model=settings.claude_code_model)
        request.app.state.claude_code = claude_code

    status, version = await claude_code.check_availability()
    request.app.state.claude_code_status = status.value
    request.app.state.claude_code_version = version

    return ClaudeCodeStatusResponse(
        status=status.value,
        version=version,
        active=getattr(request.app.state, "active_ai_provider", "openclaw") == "claude_code",
    )
