"""Execution-provider health and discovery endpoints."""

from auth.dependencies import get_current_user
from exceptions import NotFoundError
from execution.opencode_server import OpenCodeAdapter
from execution.paseo_cli import PaseoCLIAdapter
from fastapi import APIRouter, Depends, Request
from schemas.execution_provider import ExecutionProviderStatus
from services.agents import opencode_execution_service
from services.agents.paseo_execution_service import adapter_from_settings


router = APIRouter()


def _paseo_adapter(request: Request) -> PaseoCLIAdapter:
    return getattr(request.app.state, "paseo_adapter", None) or adapter_from_settings()


def _opencode_adapter(request: Request) -> OpenCodeAdapter:
    return getattr(request.app.state, "opencode_adapter", None) or (
        opencode_execution_service.adapter_from_settings()
    )


async def _statuses(request: Request) -> list[ExecutionProviderStatus]:
    paseo = await _paseo_adapter(request).health()
    opencode = await _opencode_adapter(request).health()
    return [
        ExecutionProviderStatus(
            id="builtin",
            label="Built-in AI and skills",
            enabled=True,
            available=True,
            connected=True,
            host="ClawChat",
        ),
        ExecutionProviderStatus(
            id="paseo",
            label="Paseo daemon",
            **paseo,
        ),
        ExecutionProviderStatus(
            id="opencode",
            label="OpenCode",
            **opencode,
        ),
    ]


@router.get("", response_model=list[ExecutionProviderStatus])
async def list_execution_providers(
    request: Request,
    _user: str = Depends(get_current_user),
):
    return await _statuses(request)


@router.post("/{provider_id}/test", response_model=ExecutionProviderStatus)
async def test_execution_provider(
    provider_id: str,
    request: Request,
    _user: str = Depends(get_current_user),
):
    for status in await _statuses(request):
        if status.id == provider_id:
            return status
    raise NotFoundError(f"Unknown execution provider {provider_id!r}")
