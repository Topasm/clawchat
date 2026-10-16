"""API contracts for device data sources and the requests relayed to them."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from schemas._utc import UtcDatetime

DataSourceKind = Literal["obsidian_vault", "folder"]
DataSourceOperation = Literal["list", "read", "search"]
#: Changes a source can take, each only after the user approves it.
DataSourceWriteOperation = Literal["append_todo"]
#: Everything the request log records: reads and approved writes.
DataSourceLoggedOperation = Literal["list", "read", "search", "append_todo"]
DataSourceQueryStatus = Literal[
    "awaiting_approval", "queued", "claimed", "done", "failed", "denied", "expired"
]

_FOLDER_LIST = Field(default_factory=list, max_length=100)


class DataSourceRegister(BaseModel):
    """A desktop app offering a folder on its machine for reading."""

    #: The machine's stable identity, as the worker reports it.
    device_id: UUID
    #: How the machine is named, for a first registration.
    host_label: str = Field(min_length=1, max_length=200)
    platform: str | None = Field(default=None, max_length=50)
    kind: DataSourceKind = "obsidian_vault"
    name: str = Field(min_length=1, max_length=200)
    capabilities: list[DataSourceOperation] = Field(
        default_factory=lambda: ["list", "read", "search"], min_length=1
    )
    #: Folders, relative to the source root, that may be read. Empty: all.
    include_folders: list[str] = _FOLDER_LIST
    #: Folders that are never read, even inside an included one.
    exclude_folders: list[str] = _FOLDER_LIST
    #: Chat and agents may search and read the source. Set on the machine
    #: that holds it, with every registration; leaving it out turns it off.
    ai_access: bool = False
    #: The source takes changes, each one approved in review first. The
    #: machine keeps its own copy of this switch and refuses without it.
    allow_writes: bool = False


class DataSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    capabilities: list[DataSourceOperation] | None = Field(default=None, min_length=1)
    include_folders: list[str] | None = Field(default=None, max_length=100)
    exclude_folders: list[str] | None = Field(default=None, max_length=100)


class DataSourceResponse(BaseModel):
    id: str
    host_id: str
    host_label: str
    kind: DataSourceKind
    name: str
    capabilities: list[DataSourceOperation]
    include_folders: list[str]
    exclude_folders: list[str]
    #: Chat and agents may search and read the shared folders.
    ai_access: bool = False
    #: Changes are taken, each after approval in review.
    allow_writes: bool = False
    #: The machine is asking for requests right now, so live reads work.
    is_online: bool
    #: When the machine last asked; what "offline since" refers to.
    last_seen_at: UtcDatetime | None = None
    index_updated_at: UtcDatetime | None = None
    #: Files in the light index kept for when the machine is off.
    indexed_files: int = 0
    created_at: UtcDatetime


class DataSourceQueryRequest(BaseModel):
    op: DataSourceOperation
    #: A folder for ``list``, a file for ``read``, the folder to search under
    #: for ``search``. Relative to the source root.
    path: str | None = Field(default=None, max_length=1000)
    query: str | None = Field(default=None, max_length=200)


class DataSourceWriteRequest(BaseModel):
    """A change to propose. It waits in review until the user approves it."""

    op: DataSourceWriteOperation = "append_todo"
    #: The ``TODO.md`` to add to, relative to the source root.
    path: str = Field(min_length=1, max_length=1000)
    #: The task, one line; it is added as ``- [ ] <text>``.
    text: str = Field(min_length=1, max_length=500)


class DataSourceWriteProposal(BaseModel):
    """A proposed change and the review item that holds it."""

    query_id: str
    review_id: str
    source_id: str
    op: DataSourceWriteOperation
    path: str
    #: The exact line the machine will append once approved.
    line: str
    status: DataSourceQueryStatus


class DataSourceEntry(BaseModel):
    path: str
    name: str
    title: str
    is_dir: bool = False
    size: int | None = None
    modified_at: UtcDatetime | None = None


class DataSourceSearchMatch(BaseModel):
    path: str
    title: str
    #: The matching line, when the device searched the contents.
    snippet: str | None = None
    line: int | None = None


class DataSourceTodoItem(BaseModel):
    """A checklist line of a ``TODO.md`` that was read."""

    title: str
    status: str
    due_date: str | None = None
    priority: str | None = None
    tags: list[str] = []


class DataSourceQueryResponse(BaseModel):
    op: DataSourceOperation
    path: str
    #: ``live`` came from the machine just now; ``cache`` is the light index
    #: the server keeps, which has names and dates but never contents.
    origin: Literal["live", "cache"]
    #: Why the cache answered: the machine is off, or it did not answer in time.
    fallback_reason: Literal["offline", "timeout"] | None = None
    is_online: bool
    last_seen_at: UtcDatetime | None = None
    entries: list[DataSourceEntry] = []
    matches: list[DataSourceSearchMatch] = []
    content: str | None = None
    #: Parsed checklist when the file read was a ``TODO.md``.
    tasks: list[DataSourceTodoItem] | None = None
    #: The answer was cut to fit a size limit.
    truncated: bool = False


class DataSourceQueryLog(BaseModel):
    """One request for a source's data, as the audit trail keeps it."""

    id: str
    op: DataSourceLoggedOperation
    path: str | None = None
    query: str | None = None
    status: DataSourceQueryStatus
    error: str | None = None
    requested_by: str
    #: The paired device's name, or ``None`` for a PIN session.
    requester_name: str | None = None
    result_bytes: int | None = None
    created_at: UtcDatetime
    completed_at: UtcDatetime | None = None


class DataSourceIndexFile(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    title: str | None = Field(default=None, max_length=500)
    size: int | None = None
    modified_at: datetime | None = None


class DataSourceIndexUpdate(BaseModel):
    """The light index of a source, sent whole by the machine that holds it."""

    files: list[DataSourceIndexFile] = Field(default_factory=list, max_length=20_000)


class ClaimedDataQuery(BaseModel):
    """A request a machine has taken to answer from its own disk."""

    query_id: str
    source_id: str
    op: DataSourceLoggedOperation
    path: str
    #: What to search for; for ``append_todo``, the task text to add.
    query: str | None = None
    include_folders: list[str] = []
    exclude_folders: list[str] = []


class DataQueryAnswerEntry(BaseModel):
    path: str = Field(max_length=1000)
    title: str | None = Field(default=None, max_length=500)
    is_dir: bool = False
    size: int | None = None
    modified_at: datetime | None = None


class DataQueryAnswerMatch(BaseModel):
    path: str = Field(max_length=1000)
    title: str | None = Field(default=None, max_length=500)
    snippet: str | None = Field(default=None, max_length=1000)
    line: int | None = None


class DataQueryAnswer(BaseModel):
    """What the machine found, or why it would not or could not look."""

    ok: bool
    #: ``not_found``, ``outside_source``, ``symlink``, ``not_shared``,
    #: ``too_large``, ``unknown_source``, ``writes_not_allowed``,
    #: ``not_todo_file`` or ``io_error`` when ``ok`` is false.
    error: str | None = Field(default=None, max_length=200)
    entries: list[DataQueryAnswerEntry] = Field(default_factory=list, max_length=5_000)
    matches: list[DataQueryAnswerMatch] = Field(default_factory=list, max_length=200)
    content: str | None = Field(default=None, max_length=600_000)
    truncated: bool = False
