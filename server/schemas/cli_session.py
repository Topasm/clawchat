"""External CLI sessions stay separate from ClawChat task execution attempts."""

from typing import Literal

from pydantic import BaseModel, Field

CLIProvider = Literal["codex", "claude"]


class CLISessionResponse(BaseModel):
    id: str
    provider: CLIProvider
    title: str
    cwd: str = ""
    status: Literal[
        "running", "waiting_input", "idle", "completed", "failed", "stopped", "unknown"
    ]
    kind: Literal["interactive", "background", "history"]
    updated_at: float | None = None
    waiting_for: str | None = None
    can_send: bool = False
    can_stop: bool = False
    can_restart: bool = False
    can_read: bool = False
    resume_command: str | None = None


class CLIProviderState(BaseModel):
    provider: CLIProvider
    connected: bool
    message: str | None = None


class CLISessionListResponse(BaseModel):
    sessions: list[CLISessionResponse]
    providers: list[CLIProviderState]


class CLISessionDetailResponse(BaseModel):
    session: CLISessionResponse
    output: str = ""


class CLISessionActionRequest(BaseModel):
    action: Literal["message", "stop", "restart"]
    message: str | None = Field(None, max_length=10_000)


class CLISessionActionResponse(BaseModel):
    accepted: bool = True
