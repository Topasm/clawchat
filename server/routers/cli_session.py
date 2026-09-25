"""Authenticated controls for CLI sessions on the connected server's host."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request

from auth.dependencies import get_current_user
from config import settings
from exceptions import AppError
from execution.cli_sessions import CLISessionService
from schemas.cli_session import (
    CLIProvider,
    CLISessionActionRequest,
    CLISessionActionResponse,
    CLISessionDetailResponse,
    CLISessionListResponse,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
SessionId = Annotated[str, Path(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")]


def service(request: Request) -> CLISessionService:
    if not settings.cli_sessions_enabled:
        raise AppError(
            "CLI_SESSIONS_DISABLED", "CLI sessions are disabled on this host", 403
        )
    return (
        getattr(request.app.state, "cli_session_service", None) or CLISessionService()
    )


@router.get("", response_model=CLISessionListResponse)
async def list_sessions(adapter: CLISessionService = Depends(service)):
    return await adapter.list()


@router.get("/{provider}/{session_id}", response_model=CLISessionDetailResponse)
async def read_session(
    provider: CLIProvider,
    session_id: SessionId,
    adapter: CLISessionService = Depends(service),
):
    try:
        return await adapter.detail(provider, session_id)
    except AppError:
        raise
    except Exception as exc:
        raise AppError(
            "CLI_UNAVAILABLE",
            "Could not read this CLI session. Refresh and try again.",
            502,
        ) from exc


@router.post(
    "/{provider}/{session_id}/actions", response_model=CLISessionActionResponse
)
async def control_session(
    provider: CLIProvider,
    session_id: SessionId,
    body: CLISessionActionRequest,
    adapter: CLISessionService = Depends(service),
):
    if body.action == "message" and not (body.message or "").strip():
        raise AppError("INVALID_MESSAGE", "Enter a message", 422)
    try:
        await adapter.act(provider, session_id, body.action, body.message)
    except AppError:
        raise
    except Exception as exc:
        raise AppError(
            "CLI_UNAVAILABLE",
            "The CLI did not confirm the action. Refresh before retrying.",
            502,
        ) from exc
    return CLISessionActionResponse()
