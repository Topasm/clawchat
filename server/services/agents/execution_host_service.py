"""Choosing the machine a project's work runs on.

A project names one host and records the path its workspace has there. Work is
never moved elsewhere on its own: another machine holds different files.

Nothing is queued for a machine that is off. Work is only handed to a host that
is reachable at that moment, and asking for it otherwise is refused -- which is
honest about what will happen, and leaves no backlog to wake up into hours
later against files that have moved on.

"Offline" is therefore not "unconfigured". A project whose host is asleep is
fully described and runs as soon as that machine is back; a project with no
host and no path cannot run until someone says where it lives.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from domain.agent_run import AgentRunStatus
from exceptions import ValidationError
from models.execution_host import ExecutionHost, ProjectHostPath
from models.project import Project

#: A remote host is considered gone once it stops checking in. Kept generous:
#: a laptop that missed one heartbeat is not offline.
HOST_HEARTBEAT_GRACE = timedelta(minutes=5)

#: How much of a folder's self-description is kept. The worker already trims
#: on its side; these are the server's own ceilings so a chatty client cannot
#: push a prompt-sized blob into every run and chat turn.
MAX_CONTEXT_FILE_CHARS = 8_000
MAX_CONTEXT_TOTAL_CHARS = 24_000
CONTEXT_TRUNCATION_MARKER = "\n…(truncated)"


@dataclass(frozen=True)
class WorkspaceResolution:
    """Where a project's work runs, and why it cannot when it cannot."""

    host: ExecutionHost | None
    path: str | None
    is_available: bool

    @property
    def is_unconfigured(self) -> bool:
        """Nobody has said where this project's work lives."""
        return not self.path

    @property
    def is_offline(self) -> bool:
        """The chosen machine is known but cannot take work right now."""
        return not self.is_unconfigured and not self.is_available


def host_is_available(
    host: ExecutionHost,
    path: str | None,
    *,
    now: datetime | None = None,
) -> bool:
    """Whether [host] can take work for [path] right now."""
    if not host.is_enabled or not path:
        return False
    if host.kind == "local":
        # The decisive check for the local host: a path belonging to another
        # machine is simply not here. Reporting that as "the wrong machine"
        # beats failing obscurely somewhere deeper in the run.
        return os.path.isdir(os.path.expanduser(path))
    if host.kind == "paseo":
        if not settings.paseo_enabled:
            return False
        if host.last_seen_at is None:
            # Never probed. The adapter reports a real failure on first use,
            # which is more informative than refusing to try.
            return True
        return host_checked_in_recently(host, now=now)
    if host.kind == "worker":
        # A worker only exists while its app is running, so silence means the
        # machine is asleep or the app is closed. Never having checked in is
        # the same as gone: there is nothing to send work to.
        return host.last_seen_at is not None and host_checked_in_recently(host, now=now)
    return False


async def run_host_label(db: AsyncSession, run) -> str | None:
    """The machine a run executes on, as the user named it.

    Worker runs carry the host id; Paseo runs carry the daemon's label in
    ``host_id``; built-in runs execute on the server itself.
    """
    if run.execution_host_id:
        host = await db.get(ExecutionHost, run.execution_host_id)
        if host is not None:
            return host.label
    if run.host_id:
        return run.host_id
    return None


async def project_host_state(
    db: AsyncSession, execution_host_id: str | None
) -> tuple[str | None, bool | None]:
    """``(label, online)`` for a project's execution host; ``(None, None)`` when unset."""
    if not execution_host_id:
        return None, None
    host = await db.get(ExecutionHost, execution_host_id)
    if host is None:
        return None, None
    online = host.is_enabled and (
        host.kind != "worker" or host_checked_in_recently(host)
    )
    return host.label, online


def host_checked_in_recently(
    host: ExecutionHost, *, now: datetime | None = None
) -> bool:
    """Whether a remote execution host checked in within the shared grace."""
    if host.last_seen_at is None:
        return False
    reference = now or datetime.now(timezone.utc)
    last_seen = host.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return reference - last_seen <= HOST_HEARTBEAT_GRACE


async def get_host_path(db: AsyncSession, project_id: str, host_id: str) -> str | None:
    """The path this project's workspace has on one host."""
    return (
        await db.execute(
            select(ProjectHostPath.path).where(
                ProjectHostPath.project_id == project_id,
                ProjectHostPath.host_id == host_id,
            )
        )
    ).scalar_one_or_none()


async def list_host_paths(db: AsyncSession, project_id: str) -> list[ProjectHostPath]:
    """Every machine this project has been given a path on."""
    return list(
        (
            await db.execute(
                select(ProjectHostPath)
                .where(ProjectHostPath.project_id == project_id)
                .order_by(ProjectHostPath.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_paths_for_host(db: AsyncSession, host_id: str) -> list[ProjectHostPath]:
    """Every project folder recorded on one machine -- what its worker looks after."""
    return list(
        (
            await db.execute(
                select(ProjectHostPath)
                .where(ProjectHostPath.host_id == host_id)
                .order_by(ProjectHostPath.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def get_host_path_row(
    db: AsyncSession, project_id: str, host_id: str
) -> ProjectHostPath | None:
    return (
        await db.execute(
            select(ProjectHostPath).where(
                ProjectHostPath.project_id == project_id,
                ProjectHostPath.host_id == host_id,
            )
        )
    ).scalar_one_or_none()


def context_file_names(row: ProjectHostPath | None) -> list[str]:
    """The relative paths a folder snapshot was built from."""
    if row is None or not row.context_files:
        return []
    try:
        names = json.loads(row.context_files)
    except ValueError:
        return []
    return [name for name in names if isinstance(name, str)]


async def store_workspace_context(
    db: AsyncSession,
    project_id: str,
    host_id: str,
    files: list[tuple[str, str]],
) -> ProjectHostPath:
    """Keep what a folder says about itself, as read by the machine holding it.

    ``files`` is ``[(relative_path, text)]`` in the order the worker read them.
    Each file is cut to ``MAX_CONTEXT_FILE_CHARS`` and the whole snapshot to
    ``MAX_CONTEXT_TOTAL_CHARS``; a file that no longer fits is dropped rather
    than half-included, so the file list stays an honest account of the text.
    """
    row = await get_host_path_row(db, project_id, host_id)
    if row is None:
        raise ValidationError(
            "This project has no path on that host.",
            details={"reason": "host_path_required"},
        )

    parts: list[str] = []
    names: list[str] = []
    budget = MAX_CONTEXT_TOTAL_CHARS
    for name, text in files:
        body = text.strip()
        if not body:
            continue
        if len(body) > MAX_CONTEXT_FILE_CHARS:
            body_limit = MAX_CONTEXT_FILE_CHARS - len(CONTEXT_TRUNCATION_MARKER)
            body = body[:body_limit].rstrip() + CONTEXT_TRUNCATION_MARKER
        block = f"--- {name} ---\n{body}"
        if len(block) > budget:
            break
        parts.append(block)
        names.append(name)
        budget -= len(block) + 2

    row.context_text = "\n\n".join(parts) or None
    row.context_files = json.dumps(names)
    row.context_updated_at = datetime.now(timezone.utc)
    await db.flush()
    return row


async def workspace_context_block(
    db: AsyncSession,
    project: Project,
    *,
    max_chars: int | None = None,
) -> str:
    """The ``[Workspace …]`` block for prompts: where the work lives, and what
    that folder says about itself. Empty when the project has no folder."""
    resolution = await resolve_workspace(db, project)
    if resolution.host is None or not resolution.path:
        return ""
    header = f"[Workspace {resolution.host.label}: {resolution.path}]"
    row = await get_host_path_row(db, project.id, resolution.host.id)
    text = (row.context_text or "").strip() if row is not None else ""
    if not text:
        return header
    if max_chars is not None and len(text) > max_chars:
        text_limit = max_chars - len(CONTEXT_TRUNCATION_MARKER)
        text = text[:text_limit].rstrip() + CONTEXT_TRUNCATION_MARKER
    return f"{header}\n{text}"


async def resolve_workspace(
    db: AsyncSession,
    project: Project,
    *,
    now: datetime | None = None,
) -> WorkspaceResolution:
    """Resolve the machine and path this project's work runs on."""
    if project.execution_host_id:
        host = await db.get(ExecutionHost, project.execution_host_id)
        if host is not None:
            path = await get_host_path(db, project.id, host.id)
            # The legacy column still answers for a host recorded before paths
            # were per-machine.
            path = path or (project.execution_workspace_path or "").strip() or None
            return WorkspaceResolution(
                host=host,
                path=path,
                is_available=host_is_available(host, path, now=now),
            )

    legacy_path = (project.execution_workspace_path or "").strip() or None
    if legacy_path is None:
        return WorkspaceResolution(host=None, path=None, is_available=False)

    local = await get_local_host(db)
    if local is None:
        # No host has been registered at all: the historical shape, where the
        # path was handed straight to the provider. That is deliberately not
        # checked against this filesystem -- a Paseo workspace path lives on
        # the Paseo machine and was never expected to exist here.
        return WorkspaceResolution(host=None, path=legacy_path, is_available=True)

    return WorkspaceResolution(
        host=local,
        path=legacy_path,
        is_available=host_is_available(local, legacy_path, now=now),
    )


async def get_local_host(db: AsyncSession) -> ExecutionHost | None:
    """The machine this server runs on, if it has been registered."""
    return (
        await db.execute(
            select(ExecutionHost).where(ExecutionHost.kind == "local").limit(1)
        )
    ).scalar_one_or_none()


async def delete_host(db: AsyncSession, host: ExecutionHost) -> None:
    """Remove a host and release the projects pointing at it.

    ``projects.execution_host_id`` carries no foreign key, so the references
    are cleared here rather than by the database. A project left pointing at a
    deleted host would read as waiting for a machine that no longer exists.
    """
    await db.execute(
        update(Project)
        .where(Project.execution_host_id == host.id)
        .values(execution_host_id=None)
    )
    await db.delete(host)
    await db.flush()


async def ensure_local_host(
    db: AsyncSession,
    label: str = "This server",
) -> ExecutionHost:
    """Register the server's own machine so a first path has somewhere to go."""
    existing = await get_local_host(db)
    if existing is not None:
        return existing
    host = ExecutionHost(label=label, kind="local")
    db.add(host)
    await db.flush()
    return host


async def register_worker(
    db: AsyncSession,
    *,
    label: str,
    device_id: UUID | None = None,
    platform: str | None = None,
) -> ExecutionHost:
    """Record that a desktop app on some machine is available to run work.

    New clients report a stable device id, so renaming a machine cannot change
    its identity and two machines with the same default label cannot share
    work. Label matching remains only for adopting hosts created by an older
    client that did not have a device id yet.
    """
    normalized_label = label.strip()
    normalized_device_id = str(device_id) if device_id is not None else None
    host = None
    if normalized_device_id is not None:
        host = (
            await db.execute(
                select(ExecutionHost).where(
                    ExecutionHost.device_id == normalized_device_id
                )
            )
        ).scalar_one_or_none()

    label_host = (
        await db.execute(
            select(ExecutionHost).where(ExecutionHost.label == normalized_label)
        )
    ).scalar_one_or_none()
    if host is not None and label_host is not None and label_host.id != host.id:
        raise ValidationError(
            "That name already belongs to a different machine.",
            details={"reason": "label_device_conflict"},
        )
    if host is None and label_host is not None:
        if normalized_device_id is None and label_host.device_id is not None:
            raise ValidationError(
                "This machine registration needs a device id.",
                details={"reason": "device_id_required"},
            )
        if (
            normalized_device_id is not None
            and label_host.device_id not in {None, normalized_device_id}
        ):
            raise ValidationError(
                "That name already belongs to a different machine.",
                details={"reason": "label_device_conflict"},
            )
        host = label_host
    if host is not None and host.kind != "worker":
        # Refuse before touching the row: the label belongs to a machine that
        # is reached a different way, and checking it in would misreport it.
        raise ValidationError(
            "That name already belongs to a different kind of host.",
            details={"reason": "label_kind_conflict"},
        )
    now = datetime.now(timezone.utc)
    if host is None:
        host = ExecutionHost(
            label=normalized_label,
            device_id=normalized_device_id,
            kind="worker",
            platform=platform,
            last_seen_at=now,
        )
        db.add(host)
        await db.flush()
        return host

    if normalized_device_id is not None:
        host.device_id = normalized_device_id
        host.label = normalized_label
    host.last_seen_at = now
    if platform:
        host.platform = platform
    await db.flush()
    return host


async def record_heartbeat(db: AsyncSession, host: ExecutionHost) -> ExecutionHost:
    """Keep a worker counted as reachable."""
    host.last_seen_at = datetime.now(timezone.utc)
    await db.flush()
    return host


@dataclass(frozen=True)
class ClaimedJob:
    """A run a worker has taken responsibility for."""

    run_id: str
    instruction: str
    cwd: str
    model: str | None
    project_id: str | None = None
    #: What the machine is working on, for its own window to say.
    todo_title: str | None = None


async def claim_next_job(db: AsyncSession, host: ExecutionHost) -> ClaimedJob | None:
    """Hand this machine the oldest run waiting for it, or nothing.

    Claiming moves the run out of ``queued`` in the same transaction that
    returns it, so two polls of the same worker -- or a worker restarted
    mid-poll -- cannot both pick up the same work.
    """
    from models.agent_run import AgentRun  # local: keeps the model graph acyclic
    from models.agent_task import AgentTask
    from models.todo import Todo

    # SQLite, the default database, ignores SELECT FOR UPDATE. Select and move
    # the oldest queued row in one conditional UPDATE so two pollers cannot
    # both receive it. A loser simply asks again on its next poll.
    candidate_id = (
        select(AgentRun.id)
        .where(
            AgentRun.execution_host_id == host.id,
            AgentRun.status == AgentRunStatus.QUEUED,
        )
        .order_by(AgentRun.created_at.asc())
        .limit(1)
        .scalar_subquery()
    )
    now = datetime.now(timezone.utc)
    claimed_id = (
        await db.execute(
            update(AgentRun)
            .where(
                AgentRun.id == candidate_id,
                AgentRun.status == AgentRunStatus.QUEUED,
            )
            .values(
                status=AgentRunStatus.STARTING,
                host_id=host.label,
                heartbeat_at=now,
            )
            .returning(AgentRun.id)
        )
    ).scalar_one_or_none()
    if claimed_id is None:
        return None
    run = await db.get(AgentRun, claimed_id)
    if run is None:  # Defensive: RETURNING named a row in this transaction.
        return None

    project = await db.get(Project, run.project_id) if run.project_id else None
    cwd = await get_host_path(db, project.id, host.id) if project else None
    if not cwd:
        # The path was removed after the run was queued. Fail it rather than
        # handing the worker a job it has nowhere to run.
        run.status = AgentRunStatus.FAILED
        run.error = "This project no longer has a path on that machine."
        await db.flush()
        return None

    task = await db.get(AgentTask, run.agent_task_id)
    todo_title = None
    if task is not None and task.todo_id:
        todo_title = (
            await db.execute(select(Todo.title).where(Todo.id == task.todo_id))
        ).scalar_one_or_none()
    return ClaimedJob(
        run_id=run.id,
        instruction=run.instruction_snapshot,
        cwd=cwd,
        model=run.model,
        project_id=project.id if project else None,
        todo_title=todo_title,
    )
