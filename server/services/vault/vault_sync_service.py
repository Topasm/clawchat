"""Durable, post-commit delivery of task-plan Vault reconciliation jobs."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from config import settings
from domain.plan_proposal import (
    GLOBAL_TASK_GRAPH_SCOPE_ID,
    VaultSyncJobStatus,
)
from models.change_set import ChangeSet
from models.task_graph_state import TaskGraphState
from models.project import Project
from models.todo import Todo
from models.vault_sync_job import VaultSyncJob
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from services.vault.obsidian_export_service import reconcile_todos_in_vault

logger = logging.getLogger(__name__)

_PROCESSING_LEASE = timedelta(minutes=5)
_MAX_BATCH_SIZE = 20
_MAX_SNAPSHOT_RECONCILE_ATTEMPTS = 3


async def process_vault_sync_job(
    db: AsyncSession,
    job_id: str,
) -> VaultSyncJobStatus:
    """Claim and deliver one job, recording failures for a later retry."""
    now = datetime.now(timezone.utc)
    claim = (
        update(VaultSyncJob)
        .where(
            VaultSyncJob.id == job_id,
            or_(
                and_(
                    VaultSyncJob.status.in_(
                        [VaultSyncJobStatus.PENDING, VaultSyncJobStatus.FAILED]
                    ),
                    VaultSyncJob.available_at <= now,
                ),
                and_(
                    VaultSyncJob.status == VaultSyncJobStatus.PROCESSING,
                    VaultSyncJob.locked_at < now - _PROCESSING_LEASE,
                ),
            ),
        )
        .values(
            status=VaultSyncJobStatus.PROCESSING,
            attempts=VaultSyncJob.attempts + 1,
            locked_at=now,
            last_error=None,
        )
        .execution_options(synchronize_session=False)
        .returning(VaultSyncJob.id)
    )
    claimed_id = (await db.execute(claim)).scalar_one_or_none()
    await db.commit()
    if claimed_id is None:
        existing = await db.get(VaultSyncJob, job_id)
        if existing is None:
            raise LookupError(f"Vault sync job {job_id} not found")
        return VaultSyncJobStatus(existing.status)

    job = await db.get(VaultSyncJob, job_id)
    assert job is not None
    try:
        payload = json.loads(job.payload_json)
        todo_ids = set(payload.get("todo_ids", []))
        removed_todo_ids = set(payload.get("removed_todo_ids", []))
        if not all(
            isinstance(item, str) and item for item in todo_ids | removed_todo_ids
        ):
            raise ValueError("Vault sync job contains invalid todo IDs")

        if settings.obsidian_vault_path:
            await _reconcile_latest_snapshot(
                db,
                todo_ids=todo_ids,
                removed_todo_ids=removed_todo_ids,
            )

        job = await db.get(VaultSyncJob, job_id)
        assert job is not None
        job.status = VaultSyncJobStatus.SUCCEEDED
        job.locked_at = None
        job.completed_at = datetime.now(timezone.utc)
        await _update_change_set_response(db, job, VaultSyncJobStatus.SUCCEEDED)
        await db.commit()
        return VaultSyncJobStatus.SUCCEEDED
    except Exception as exc:
        await db.rollback()
        logger.warning("Vault sync job %s failed", job_id, exc_info=True)
        job = await db.get(VaultSyncJob, job_id)
        assert job is not None
        job.status = VaultSyncJobStatus.FAILED
        job.locked_at = None
        job.last_error = str(exc)
        job.available_at = datetime.now(timezone.utc) + timedelta(
            seconds=min(2 ** min(job.attempts, 8), 300)
        )
        await _update_change_set_response(db, job, VaultSyncJobStatus.FAILED)
        await db.commit()
        return VaultSyncJobStatus.FAILED


async def _reconcile_latest_snapshot(
    db: AsyncSession,
    *,
    todo_ids: set[str],
    removed_todo_ids: set[str],
) -> None:
    """Write a canonical snapshot and retry if the graph changed during I/O.

    Database transactions deliberately never span filesystem access. Without
    the post-write revision check, however, an older job can finish after a
    newer job and overwrite its markers with a stale ORM snapshot. A bounded
    retry makes each successful delivery end on a snapshot that was still
    current after the write, while persistent graph churn falls back to the
    durable outbox retry path.
    """
    for attempt in range(1, _MAX_SNAPSHOT_RECONCILE_ATTEMPTS + 1):
        (
            snapshot_revision,
            items,
            missing_todo_ids,
        ) = await _load_reconciliation_snapshot(db, todo_ids)
        # _load_reconciliation_snapshot ends its read transaction before I/O.
        await asyncio.to_thread(
            reconcile_todos_in_vault,
            settings.obsidian_vault_path,
            items,
            removed_todo_ids | missing_todo_ids,
        )
        current_revision = await _current_graph_revision(db)
        await db.commit()
        if current_revision == snapshot_revision:
            return
        logger.info(
            "Vault snapshot changed during delivery; retrying (%d/%d, %d -> %d)",
            attempt,
            _MAX_SNAPSHOT_RECONCILE_ATTEMPTS,
            snapshot_revision,
            current_revision,
        )
    raise RuntimeError(
        "Task graph kept changing while the Vault snapshot was reconciled"
    )


async def _load_reconciliation_snapshot(
    db: AsyncSession,
    todo_ids: set[str],
) -> tuple[int, list[tuple[Todo, str | None]], set[str]]:
    snapshot_revision = await _current_graph_revision(db)
    todo_rows = (
        list(
            (
                await db.execute(
                    select(Todo)
                    .where(Todo.id.in_(todo_ids))
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        if todo_ids
        else []
    )
    parent_ids = {todo.parent_id for todo in todo_rows if todo.parent_id}
    parent_rows = (
        list(
            (
                await db.execute(
                    select(Todo)
                    .where(Todo.id.in_(parent_ids))
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        if parent_ids
        else []
    )
    parent_by_id = {todo.id: todo for todo in parent_rows}
    project_ids = {todo.project_id for todo in todo_rows if todo.project_id}
    project_rows = (
        (
            await db.execute(
                select(Project.id, Project.title).where(Project.id.in_(project_ids))
            )
        ).all()
        if project_ids
        else []
    )
    project_names = dict(project_rows)
    items = [
        (
            todo,
            project_names.get(todo.project_id)
            or (
                (
                    parent_by_id[todo.parent_id].source_id
                    or parent_by_id[todo.parent_id].title
                )
                if todo.parent_id in parent_by_id
                else None
            ),
        )
        for todo in todo_rows
    ]
    missing_todo_ids = todo_ids - {todo.id for todo in todo_rows}
    await db.commit()
    return snapshot_revision, items, missing_todo_ids


async def _current_graph_revision(db: AsyncSession) -> int:
    revision = (
        await db.execute(
            select(TaskGraphState.revision).where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID
            )
        )
    ).scalar_one_or_none()
    if revision is None:
        raise RuntimeError("Global task graph state is not initialized")
    return revision


async def process_pending_vault_sync_jobs(
    db: AsyncSession,
    *,
    limit: int = _MAX_BATCH_SIZE,
) -> dict[str, int]:
    """Retry a bounded batch; safe to invoke at startup or after apply/undo."""
    now = datetime.now(timezone.utc)
    rows = await db.execute(
        select(VaultSyncJob.id)
        .where(
            or_(
                and_(
                    VaultSyncJob.status.in_(
                        [VaultSyncJobStatus.PENDING, VaultSyncJobStatus.FAILED]
                    ),
                    VaultSyncJob.available_at <= now,
                ),
                and_(
                    VaultSyncJob.status == VaultSyncJobStatus.PROCESSING,
                    VaultSyncJob.locked_at < now - _PROCESSING_LEASE,
                ),
            )
        )
        .order_by(VaultSyncJob.available_at, VaultSyncJob.created_at)
        .limit(max(1, min(limit, _MAX_BATCH_SIZE)))
    )
    job_ids = list(rows.scalars().all())
    await db.commit()
    counts = {"succeeded": 0, "failed": 0}
    for job_id in job_ids:
        status = await process_vault_sync_job(db, job_id)
        if status == VaultSyncJobStatus.SUCCEEDED:
            counts["succeeded"] += 1
        elif status == VaultSyncJobStatus.FAILED:
            counts["failed"] += 1
    return counts


async def _update_change_set_response(
    db: AsyncSession,
    job: VaultSyncJob,
    status: VaultSyncJobStatus,
) -> None:
    if job.change_set_id is None:
        return
    change_set = await db.get(ChangeSet, job.change_set_id)
    if change_set is None:
        return
    attribute = (
        "undo_response_json"
        if job.event_type == "task_plan_reverted"
        else "response_json"
    )
    raw_response = getattr(change_set, attribute)
    if not raw_response:
        return
    try:
        response = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError):
        logger.warning(
            "Change-set %s contains invalid stored response JSON",
            change_set.id,
        )
        return
    response["vault_sync_status"] = status.value
    setattr(
        change_set,
        attribute,
        json.dumps(
            response,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ),
    )
