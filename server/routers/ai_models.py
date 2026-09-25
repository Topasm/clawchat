"""Authenticated model preferences for ClawChat's own AI calls."""

from fastapi import APIRouter, Depends, Request

from auth.dependencies import get_current_user
from config import settings
from exceptions import AppError
from schemas.ai_models import (
    AIModelCatalog,
    AIModelSelection,
    AIModelUpdate,
    ModelProvider,
)
from services.ai.model_catalog import discover_models
from services.ai.model_settings import MODEL_FIELDS, save_model

router = APIRouter(dependencies=[Depends(get_current_user)])
BACKENDS = {
    "codex_cli": "codex_cli",
    "claude_code": "claude_code",
    "codex": "codex_api",
}


def backend_for(request: Request, provider: str):
    backend = getattr(request.app.state, BACKENDS[provider], None)
    if backend is None:
        raise AppError("AI_NOT_INITIALIZED", "The AI provider is not initialized", 409)
    return backend


@router.get("/{provider}", response_model=AIModelCatalog)
async def get_models(provider: ModelProvider, request: Request):
    backend = backend_for(request, provider)
    models, source = await discover_models(provider, backend)
    current = backend.model
    if current and current not in models:
        models.append(current)
    return AIModelCatalog(
        provider=provider,
        model=current,
        persistent=bool(settings.ai_models_file),
        models=models,
        source=source,
    )


@router.put("/{provider}", response_model=AIModelSelection)
async def set_model(provider: ModelProvider, body: AIModelUpdate, request: Request):
    backend = backend_for(request, provider)
    if provider == "codex" and not body.model:
        raise AppError("MODEL_REQUIRED", "Enter an API model ID", 422)
    if settings.ai_models_file:
        try:
            save_model(settings.ai_models_file, provider, body.model)
        except (OSError, ValueError) as exc:
            raise AppError(
                "MODEL_SAVE_FAILED", "Could not save the model preference", 503
            ) from exc
    backend.model = body.model
    setattr(settings, MODEL_FIELDS[provider], body.model)
    if provider == "codex":
        request.app.state.codex_api_status = "unknown"
    return AIModelSelection(
        provider=provider,
        model=body.model,
        persistent=bool(settings.ai_models_file),
    )
