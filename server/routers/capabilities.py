"""Capabilities endpoint — reports which server features are active."""

from fastapi import APIRouter, Depends, Request

from auth.dependencies import get_current_user
from config import settings
from schemas.capabilities import (
    AICapability,
    CapabilitiesResponse,
    FeaturesCapability,
)
from skills import skill_ids

router = APIRouter()


@router.get("", response_model=CapabilitiesResponse)
async def get_capabilities(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Return which features are available on this server instance."""
    active_provider = getattr(request.app.state, "active_ai_provider", None)
    ai_connected = getattr(request.app.state, "ai_connected", False)

    # Provider-specific readiness is tracked independently so a failed optional
    # backend does not mark the core local workspace unhealthy.
    if active_provider == "claude_code":
        ai_available = (
            getattr(request.app.state, "claude_code_status", "") == "available"
        )
        ai_model = f"claude {settings.claude_code_model or 'default'} (via CLI)"
    elif active_provider == "codex":
        ai_available = (
            getattr(request.app.state, "codex_api_status", "") == "available"
        )
        codex_api = getattr(request.app.state, "codex_api", None)
        ai_model = getattr(codex_api, "model", settings.codex_model)
    elif active_provider == "codex_cli":
        ai_available = (
            getattr(request.app.state, "codex_cli_status", "") == "available"
        )
        codex_cli = getattr(request.app.state, "codex_cli", None)
        ai_model = getattr(codex_cli, "model", "") or "Codex CLI default"
    else:
        ai_available = ai_connected
        ai_model = settings.ai_model

    # Obsidian is available when a vault path is configured
    obsidian_enabled = bool(settings.obsidian_vault_path)

    # Inbox pipeline requires a working AI provider
    inbox_pipeline = ai_available

    # Agent tasks require AI as well
    agent_tasks = ai_available

    return CapabilitiesResponse(
        ai=AICapability(
            provider=active_provider,
            model=ai_model,
            available=ai_available,
        ),
        features=FeaturesCapability(
            obsidian=obsidian_enabled,
            calendar=True,
            kanban=True,
            inbox_pipeline=inbox_pipeline,
            skills=skill_ids(),
            agent_tasks=agent_tasks,
        ),
        version=request.app.version,
    )
