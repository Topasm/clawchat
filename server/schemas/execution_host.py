"""API contracts for execution hosts and the paths projects have on them."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from models.execution_host import EXECUTION_HOST_KINDS

_KIND_PATTERN = f"^({'|'.join(EXECUTION_HOST_KINDS)})$"


class ExecutionHostCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    kind: str = Field(default="local", pattern=_KIND_PATTERN)
    #: Connection string for a remote kind; ignored by "local".
    target: str | None = None
    platform: str | None = Field(default=None, max_length=50)
    is_enabled: bool = True


class ExecutionHostUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    kind: str | None = Field(default=None, pattern=_KIND_PATTERN)
    target: str | None = None
    platform: str | None = Field(default=None, max_length=50)
    is_enabled: bool | None = None


class ExecutionHostResponse(BaseModel):
    id: str
    label: str
    kind: str
    target: str | None = None
    platform: str | None = None
    is_enabled: bool
    last_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkerRegistration(BaseModel):
    """A desktop app announcing the machine it runs on."""

    label: str = Field(min_length=1, max_length=200)
    platform: str | None = Field(default=None, max_length=50)


class ProjectHostPathUpsert(BaseModel):
    host_id: str = Field(min_length=1)
    path: str = Field(min_length=1)


class ProjectExecutionHostSelect(BaseModel):
    host_id: str = Field(min_length=1)


class ProjectHostPathResponse(BaseModel):
    host_id: str
    path: str
    #: When the worker on that host last sent what the folder says about itself.
    context_updated_at: datetime | None = None
    #: Relative paths the folder snapshot was assembled from.
    context_files: list[str] = []

    model_config = ConfigDict(from_attributes=True)


class WorkspaceContextFile(BaseModel):
    """One README-like file the worker read from the bound folder."""

    path: str = Field(min_length=1, max_length=500)
    text: str = Field(max_length=64_000)


class ProjectWorkspaceContextUpsert(BaseModel):
    """What a folder says about itself, sent by the machine that holds it."""

    host_id: str = Field(min_length=1)
    files: list[WorkspaceContextFile] = Field(default_factory=list, max_length=16)


class HostProjectPathResponse(BaseModel):
    """A project this machine holds a folder for, as the worker sees it."""

    project_id: str
    path: str
    context_updated_at: datetime | None = None


class ProjectWorkspaceResponse(BaseModel):
    """Where a project's work runs, and whether it can run right now."""

    host_id: str | None = None
    host_label: str | None = None
    path: str | None = None
    #: The chosen machine can take work now.
    is_available: bool = False
    #: The machine is known but unreachable, so work is refused until it is back.
    is_offline: bool = False
    #: No machine and path have been recorded yet.
    is_unconfigured: bool = True
    #: Every machine this project has a path on.
    paths: list[ProjectHostPathResponse] = []
    #: Folder snapshot on the chosen machine, if its worker has sent one.
    context_updated_at: datetime | None = None
    context_files: list[str] = []


class ClaimedJobResponse(BaseModel):
    """The work a machine has just taken responsibility for."""

    run_id: str
    instruction: str
    #: Directory the CLI runs in, on the claiming machine.
    cwd: str
    model: str | None = None
    #: The project whose folder ``cwd`` is, so the worker can refresh its snapshot.
    project_id: str | None = None
    #: What the machine is working on, for its own window to say.
    todo_title: str | None = None
