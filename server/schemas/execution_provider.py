"""Execution-provider discovery and health contracts."""

from typing import Any

from pydantic import BaseModel, Field


class ExecutionProviderStatus(BaseModel):
    id: str
    label: str
    enabled: bool
    available: bool
    connected: bool
    host: str | None = None
    error: str | None = None
    providers: list[dict[str, Any]] = Field(default_factory=list)
    #: How the provider's agent is allowed to act (Orca: "ask" or "auto").
    permission_mode: str | None = None
    #: True when ClawChat starts and watches this provider's runtime itself.
    managed: bool = False
    #: That runtime's state: starting, running, reused, restarting, failed or
    #: stopped. ``error`` says why it is down.
    runtime_state: str | None = None


class OrcaRepository(BaseModel):
    """A repository registered with the Orca on this machine."""

    path: str
    name: str

