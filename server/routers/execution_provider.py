"""Execution-provider health and discovery endpoints."""

from auth.dependencies import get_current_user
from config import settings
from exceptions import ConflictError, NotFoundError
from execution.opencode_server import OpenCodeAdapter
from execution.orca_cli import OrcaAdapter, OrcaError
from fastapi import APIRouter, Depends, Request
from schemas.execution_provider import ExecutionProviderStatus, OrcaRepository
from services.agents import opencode_execution_service, orca_execution_service


router = APIRouter()


def _opencode_adapter(request: Request) -> OpenCodeAdapter:
    return getattr(request.app.state, "opencode_adapter", None) or (
        opencode_execution_service.adapter_from_settings()
    )


def _orca_adapter(request: Request) -> OrcaAdapter:
    return getattr(request.app.state, "orca_adapter", None) or (
        orca_execution_service.adapter_from_settings()
    )


async def _statuses(request: Request) -> list[ExecutionProviderStatus]:
    opencode = await _opencode_adapter(request).health()
    orca = await _orca_adapter(request).health()
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
            id="opencode",
            label="OpenCode",
            **opencode,
        ),
        ExecutionProviderStatus(
            id="orca",
            label="Orca",
            permission_mode=settings.orca_permission_mode,
            **orca,
        ),
    ]


@router.get("", response_model=list[ExecutionProviderStatus])
async def list_execution_providers(
    request: Request,
    _user: str = Depends(get_current_user),
):
    return await _statuses(request)


@router.get("/orca/repositories", response_model=list[OrcaRepository])
async def list_orca_repositories(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """The repositories Orca knows on this machine, to pick a project's folder from."""
    adapter = _orca_adapter(request)
    if not adapter.enabled:
        return []
    try:
        return [OrcaRepository(**repo) for repo in await adapter.list_repos()]
    except OrcaError as exc:
        raise ConflictError(f"Orca could not list its repositories: {exc.message}") from exc


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
