"""Durable AgentRun lifecycle, event log, and in-process cancellation registry."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Coroutine
from datetime import datetime, timezone
from typing import Any

from domain.agent_run import (
    AGENT_RUN_ACTIVE_STATUSES,
    AGENT_RUN_EXECUTING_STATUSES,
    AgentRunStatus,
)
from domain.review import ArtifactType, ReviewRiskLevel, ReviewStatus, ReviewSubjectType
from domain.task import TaskStatus
from exceptions import ConflictError, NotFoundError
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.conversation import Conversation
from models.project import Project
from models.todo import Todo
from schemas.agent_run import AgentRunEventResponse, AgentRunResponse
from schemas.review import AgentRunReviewOutcome
from services.agents import execution_host_service, run_thread_service
from services.review import (
    agent_review_handoff_service,
    artifact_service,
    review_item_service,
)
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils import deserialize_tags, make_id
from ws.manager import ws_manager
from ws.notifications import notify_after_commit

# Single-user server: every client session authenticates as this subject.
DEFAULT_USER_ID = "user"

_execution_tasks: dict[str, asyncio.Task] = {}


def _is_experiment_todo(todo: Todo) -> bool:
    return any(
        tag.removeprefix("#").startswith("exp/") for tag in deserialize_tags(todo.tags)
    )


async def _publish_approved_report(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
    todo: Todo | None,
) -> None:
    if not run.project_id:
        return
    existing = (
        await db.execute(
            select(Artifact.id).where(
                Artifact.project_id == run.project_id,
                Artifact.created_by == run.id,
                Artifact.type == ArtifactType.REPORT,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    await artifact_service.create_artifact(
        db,
        project_id=run.project_id,
        task_id=task.todo_id,
        type=ArtifactType.REPORT,
        title=f"Run report · {todo.title if todo else task.task_type}",
        content=run.result or run.result_summary or "",
        source=f"agent_run:{run.provider}",
        created_by=run.id,
    )


async def notify_run_state(
    db: AsyncSession,
    run: AgentRun,
    task: AgentTask | None = None,
    *,
    review_id: str | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> None:
    """Push one ``run_state_changed`` event describing where a run is now.

    ``module_data_changed`` only tells clients to refetch; it carries nothing a
    client could show without another round trip, so a run that stops to ask
    for input or review used to be silent unless the Runs page happened to be
    open. This event is the user-facing signal: the chat card, toast, badge and
    mobile notification all read from it. Sent at every lifecycle transition
    so the whole story reaches whichever surface the user is looking at.
    """
    if task is None:
        task = await db.get(AgentTask, run.agent_task_id)
    todo = (
        await db.get(Todo, task.todo_id) if task is not None and task.todo_id else None
    )
    title = todo.title if todo is not None else run.instruction_snapshot[:120]
    host_label = await execution_host_service.run_host_label(db, run)
    payload = {
        "host_label": host_label,
        "run_id": run.id,
        "agent_task_id": run.agent_task_id,
        "todo_id": task.todo_id if task is not None else None,
        "project_id": run.project_id,
        "conversation_id": task.conversation_id if task is not None else None,
        "parent_task_id": task.parent_task_id if task is not None else None,
        "title": title,
        "status": str(run.status),
        "attempt": run.attempt,
        "provider": run.provider,
        "progress": run.progress,
        "progress_message": run.progress_message,
        "result_summary": run.result_summary,
        "error": run.error,
        "is_adopted": run.is_adopted,
        "review_id": review_id,
    }
    notify_after_commit(
        db,
        {"type": "run_state_changed", "data": payload},
        user_id,
        send_json=ws_manager.send_json,
    )
    if task is not None:
        await run_thread_service.post_run_update(
            db, run, task, review_id=review_id, user_id=user_id
        )


async def infer_project_id(db: AsyncSession, task: AgentTask) -> str | None:
    if task.todo_id:
        project_id = (
            await db.execute(select(Todo.project_id).where(Todo.id == task.todo_id))
        ).scalar_one_or_none()
        if project_id:
            return project_id
    if task.conversation_id:
        return (
            await db.execute(
                select(Conversation.project_id).where(
                    Conversation.id == task.conversation_id
                )
            )
        ).scalar_one_or_none()
    return None


async def create_run(
    db: AsyncSession,
    task: AgentTask,
    *,
    provider: str,
    model: str | None = None,
    host_id: str | None = None,
    workspace_id: str | None = None,
    instruction_snapshot: str | None = None,
    update_todo_status: bool = True,
) -> AgentRun:
    from services.agents.run_context_service import build_execution_instruction

    active = (
        await db.execute(
            select(AgentRun.id).where(
                AgentRun.agent_task_id == task.id,
                AgentRun.status.in_(AGENT_RUN_ACTIVE_STATUSES),
            )
        )
    ).scalar_one_or_none()
    if active is not None:
        raise ConflictError("This agent task already has an active run")
    last_attempt = (
        await db.execute(
            select(func.max(AgentRun.attempt)).where(AgentRun.agent_task_id == task.id)
        )
    ).scalar_one_or_none() or 0
    if task.skill_chain:
        # A retry is a new attempt and starts from skill zero. Resuming a
        # waiting run does not come through create_run and keeps its checkpoint.
        from skills.executor import reset_skill_chain_checkpoint

        reset_skill_chain_checkpoint(task)
    # A supplied snapshot belongs to an earlier attempt and is already fully
    # assembled. Only a brand-new run freezes project and conversation context.
    frozen_instruction = (
        instruction_snapshot
        if instruction_snapshot is not None
        else await build_execution_instruction(db, task)
    )
    run = AgentRun(
        id=make_id("run_"),
        agent_task_id=task.id,
        project_id=await infer_project_id(db, task),
        attempt=last_attempt + 1,
        instruction_snapshot=frozen_instruction,
        provider=provider,
        model=model,
        host_id=host_id,
        workspace_id=workspace_id,
        status=AgentRunStatus.QUEUED,
    )
    task.status = "queued"
    task.result = None
    task.error = None
    task.progress = 0
    task.progress_message = None
    task.started_at = None
    task.completed_at = None
    if task.todo_id and update_todo_status:
        todo = await db.get(Todo, task.todo_id)
        if todo is not None:
            todo.status = TaskStatus.IN_PROGRESS
            todo.completed_at = None
    db.add(run)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "Another agent run attempt was created concurrently"
        ) from exc
    # Work started outside chat gets a thread of its own here, so the run has
    # somewhere to report from its first transition on.
    await run_thread_service.ensure_thread(db, run, task)
    await record_event(db, run, "queued", "Execution queued", progress=0)
    return run


async def current_run_for_task(db: AsyncSession, task_id: str) -> AgentRun | None:
    return (
        await db.execute(
            select(AgentRun)
            .where(AgentRun.agent_task_id == task_id)
            .order_by(AgentRun.attempt.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def require_run(db: AsyncSession, run_id: str) -> AgentRun:
    run = await db.get(AgentRun, run_id)
    if run is None:
        raise NotFoundError("Agent run not found")
    return run


async def require_run_for_update(db: AsyncSession, run_id: str) -> AgentRun:
    """Load and lock a run whose lifecycle is about to be changed."""
    run = (
        await db.execute(
            select(AgentRun).where(AgentRun.id == run_id).with_for_update()
        )
    ).scalar_one_or_none()
    if run is None:
        raise NotFoundError("Agent run not found")
    return run


async def record_event(
    db: AsyncSession,
    run: AgentRun,
    event_type: str,
    message: str | None = None,
    *,
    progress: int | None = None,
    payload: dict[str, Any] | None = None,
) -> AgentRunEvent:
    sequence = (
        await db.execute(
            select(func.max(AgentRunEvent.sequence)).where(
                AgentRunEvent.run_id == run.id
            )
        )
    ).scalar_one_or_none() or 0
    event = AgentRunEvent(
        id=make_id("run_event_"),
        run_id=run.id,
        sequence=sequence + 1,
        event_type=event_type,
        message=message,
        progress=progress,
        payload_json=(json.dumps(payload, ensure_ascii=False) if payload else None),
    )
    db.add(event)
    return event


async def mark_starting(db: AsyncSession, run: AgentRun) -> None:
    now = datetime.now(timezone.utc)
    run.status = AgentRunStatus.STARTING
    run.started_at = run.started_at or now
    run.heartbeat_at = now
    await record_event(db, run, "starting", "Execution is starting", progress=0)
    await notify_run_state(db, run)


async def mark_running(db: AsyncSession, run: AgentRun) -> None:
    await db.refresh(run)
    if run.status == AgentRunStatus.CANCELLED:
        raise asyncio.CancelledError
    now = datetime.now(timezone.utc)
    run.status = AgentRunStatus.RUNNING
    run.started_at = run.started_at or now
    run.heartbeat_at = now
    await record_event(db, run, "running", "Execution started", progress=run.progress)
    await notify_run_state(db, run)


async def update_progress(
    db: AsyncSession,
    run: AgentRun,
    progress: int,
    message: str,
) -> None:
    await db.refresh(run)
    if run.status == AgentRunStatus.CANCELLED:
        raise asyncio.CancelledError
    run.progress = progress
    run.progress_message = message
    run.heartbeat_at = datetime.now(timezone.utc)
    await record_event(db, run, "progress", message, progress=progress)


async def mark_waiting_review(
    db: AsyncSession,
    run: AgentRun,
    task: AgentTask,
    result: str,
) -> None:
    await db.refresh(run)
    if run.status == AgentRunStatus.CANCELLED:
        raise asyncio.CancelledError
    now = datetime.now(timezone.utc)
    run.status = AgentRunStatus.WAITING_REVIEW
    run.progress = 100
    run.progress_message = "Waiting for review"
    run.result = result
    run.result_summary = result[:500]
    run.error = None
    run.heartbeat_at = now
    run.completed_at = now
    await record_event(
        db, run, "waiting_review", "Result is ready for review", progress=100
    )
    review_id = None
    if task.parent_task_id is None:
        review_item = await review_item_service.ensure_review_item(
            db,
            subject_type=ReviewSubjectType.AGENT_RUN,
            subject_id=run.id,
            project_id=run.project_id,
            summary=f"Review {task.agent_type} result",
            risk_level=ReviewRiskLevel.MEDIUM,
        )
        review_item.status = ReviewStatus.PENDING
        review_item.requested_at = now
        review_item.reviewed_at = None
        review_item.review_note = None
        await db.flush()
        review_id = review_item.id
    else:
        run.status = AgentRunStatus.COMPLETED
        run.is_adopted = True
    await notify_run_state(db, run, task, review_id=review_id)


async def mark_failed(db: AsyncSession, run: AgentRun, error: str) -> None:
    await db.flush()
    await db.refresh(run)
    if run.status == AgentRunStatus.CANCELLED:
        return
    now = datetime.now(timezone.utc)
    run.status = AgentRunStatus.FAILED
    run.error = error
    run.heartbeat_at = now
    run.completed_at = now
    await record_event(db, run, "failed", error, progress=run.progress)
    await notify_run_state(db, run)


async def cancel_run(db: AsyncSession, run_id: str) -> AgentRun:
    run = await require_run(db, run_id)
    if run.status not in {
        *AGENT_RUN_EXECUTING_STATUSES,
        AgentRunStatus.WAITING_INPUT,
    }:
        raise ConflictError(f"Agent run cannot be cancelled from {run.status}")
    now = datetime.now(timezone.utc)
    run.status = AgentRunStatus.CANCELLED
    run.cancel_requested_at = now
    run.completed_at = now
    run.error = "Cancelled by user"
    task = await db.get(AgentTask, run.agent_task_id)
    if task is not None:
        task.status = "cancelled"
        task.error = run.error
        task.completed_at = now
    await record_event(db, run, "cancelled", run.error, progress=run.progress)
    await notify_run_state(db, run, task)
    await db.commit()
    execution = _execution_tasks.get(run.id)
    if execution is not None and not execution.done():
        execution.cancel()
    return run


async def transition_run(
    db: AsyncSession,
    run: AgentRun,
    status: AgentRunStatus,
    message: str | None,
    *,
    payload: dict[str, Any] | None = None,
) -> AgentRun:
    allowed = {
        AgentRunStatus.STARTING: {AgentRunStatus.RUNNING},
        AgentRunStatus.RUNNING: {
            AgentRunStatus.WAITING_INPUT,
            AgentRunStatus.WAITING_REVIEW,
        },
        AgentRunStatus.WAITING_INPUT: {AgentRunStatus.RUNNING},
    }
    if status not in allowed.get(AgentRunStatus(run.status), set()):
        raise ConflictError(
            f"Cannot transition agent run from {run.status} to {status}"
        )
    run.status = status
    run.heartbeat_at = datetime.now(timezone.utc)
    if message:
        run.progress_message = message
    await record_event(
        db, run, status.value, message, progress=run.progress, payload=payload
    )
    await notify_run_state(db, run)
    return run


async def decide_run(
    db: AsyncSession,
    run_id: str,
    decision: ReviewStatus,
    *,
    expected_status: AgentRunStatus | None = None,
) -> AgentRunReviewOutcome | dict[str, Any]:
    run = await require_run(db, run_id)
    task = await db.get(AgentTask, run.agent_task_id)
    if task is None:
        raise NotFoundError("Agent task not found")
    current_status = AgentRunStatus(run.status)
    if expected_status is not None and current_status != expected_status:
        raise ConflictError("Agent run changed before it could be reviewed")
    expected_status = expected_status or current_status
    if expected_status not in {
        AgentRunStatus.WAITING_REVIEW,
        AgentRunStatus.WAITING_INPUT,
    }:
        raise ConflictError(f"Agent run cannot be reviewed from {expected_status}")
    if decision == ReviewStatus.APPROVED:
        todo = await db.get(Todo, task.todo_id) if task.todo_id else None
        before_insights = (
            await agent_review_handoff_service.load_todo_graph_insights(db, todo)
            if todo is not None
            else None
        )
        claimed = (
            await db.execute(
                update(AgentRun)
                .where(
                    AgentRun.id == run.id,
                    AgentRun.status == expected_status,
                )
                .values(status=AgentRunStatus.COMPLETED, is_adopted=True)
                .returning(AgentRun.id)
            )
        ).scalar_one_or_none()
        if claimed is None:
            raise ConflictError("Agent run was already reviewed")
        await db.execute(
            update(AgentRun)
            .where(
                AgentRun.agent_task_id == task.id,
                AgentRun.id != run.id,
            )
            .values(is_adopted=False)
        )
        run.status = AgentRunStatus.COMPLETED
        run.is_adopted = True
        task.status = "completed"
        task.result = run.result
        task.error = None
        if todo is not None and not _is_experiment_todo(todo):
            todo.status = TaskStatus.COMPLETED
            todo.completed_at = datetime.now(timezone.utc)
        await _publish_approved_report(db, run=run, task=task, todo=todo)
        if run.provider == "paseo":
            from services.agents.paseo_execution_service import publish_adopted_output

            await publish_adopted_output(db, run=run, task=task)
        await record_event(db, run, "approved", "Run result approved", progress=100)
        await db.flush()
        if todo is not None and before_insights is not None:
            after_insights = (
                await agent_review_handoff_service.load_todo_graph_insights(db, todo)
            )
            graph_revision = after_insights.graph_revision
            newly_ready_tasks = agent_review_handoff_service.newly_ready_after_approval(
                before_insights,
                after_insights,
            )
        else:
            from services.tasks.graph_command_service import current_graph_revision

            graph_revision = await current_graph_revision(db)
            newly_ready_tasks = []
        await notify_run_state(db, run, task)
        return AgentRunReviewOutcome(
            run_id=run.id,
            agent_task_id=task.id,
            todo_id=todo.id if todo is not None else None,
            todo_status=(TaskStatus(todo.status) if todo is not None else None),
            graph_revision=graph_revision,
            newly_ready_tasks=newly_ready_tasks,
            adopted=run.is_adopted,
            attempt=run.attempt,
        )
    elif decision == ReviewStatus.CHANGES_REQUESTED:
        if expected_status != AgentRunStatus.WAITING_REVIEW:
            raise ConflictError("Changes were already requested for this agent run")
        claimed = (
            await db.execute(
                update(AgentRun)
                .where(
                    AgentRun.id == run.id,
                    AgentRun.status == expected_status,
                )
                .values(status=AgentRunStatus.WAITING_INPUT)
                .returning(AgentRun.id)
            )
        ).scalar_one_or_none()
        if claimed is None:
            raise ConflictError("Agent run was already reviewed or changed")
        run.status = AgentRunStatus.WAITING_INPUT
        run.progress_message = "Changes requested"
        task.status = "running"
        await record_event(
            db, run, "changes_requested", "Changes requested", progress=100
        )
        await notify_run_state(db, run, task)
    elif decision == ReviewStatus.REJECTED:
        claimed = (
            await db.execute(
                update(AgentRun)
                .where(
                    AgentRun.id == run.id,
                    AgentRun.status == expected_status,
                )
                .values(status=AgentRunStatus.COMPLETED, is_adopted=False)
                .returning(AgentRun.id)
            )
        ).scalar_one_or_none()
        if claimed is None:
            raise ConflictError("Agent run was already reviewed")
        run.status = AgentRunStatus.COMPLETED
        run.is_adopted = False
        task.status = "failed"
        task.error = "Run result rejected"
        await record_event(db, run, "rejected", task.error, progress=100)
        await notify_run_state(db, run, task)
    else:
        raise ConflictError("Unsupported agent run review decision")
    return {
        "run_id": run.id,
        "agent_task_id": task.id,
        "attempt": run.attempt,
        "adopted": run.is_adopted,
    }


def is_execution_registered(run_id: str) -> bool:
    """Whether this process is running the coroutine behind ``run_id`` right now."""
    execution = _execution_tasks.get(run_id)
    return execution is not None and not execution.done()


def launch_execution(run_id: str, coroutine: Coroutine[Any, Any, None]) -> None:
    if run_id in _execution_tasks and not _execution_tasks[run_id].done():
        raise RuntimeError(f"Agent run {run_id} is already executing")
    execution = asyncio.create_task(coroutine, name=f"agent-run:{run_id}")
    _execution_tasks[run_id] = execution

    def cleanup(completed: asyncio.Task) -> None:
        _execution_tasks.pop(run_id, None)
        if not completed.cancelled():
            completed.exception()

    execution.add_done_callback(cleanup)


async def list_runs(
    db: AsyncSession,
    *,
    project_id: str | None = None,
    status: AgentRunStatus | None = None,
    limit: int = 100,
) -> list[AgentRunResponse]:
    query = select(AgentRun).order_by(AgentRun.created_at.desc()).limit(limit)
    if project_id:
        query = query.where(AgentRun.project_id == project_id)
    if status:
        query = query.where(AgentRun.status == status)
    runs = list((await db.execute(query)).scalars().all())
    return [await build_run_response(db, run) for run in runs]


async def build_run_response(db: AsyncSession, run: AgentRun) -> AgentRunResponse:
    task = await db.get(AgentTask, run.agent_task_id)
    if task is None:
        raise NotFoundError("Agent task not found")
    project = await db.get(Project, run.project_id) if run.project_id else None
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    usage = None
    if run.usage_json:
        try:
            usage = json.loads(run.usage_json)
        except (json.JSONDecodeError, TypeError):
            usage = None
    return AgentRunResponse(
        **{
            column: getattr(run, column)
            for column in (
                "id",
                "agent_task_id",
                "project_id",
                "attempt",
                "provider",
                "instruction_snapshot",
                "model",
                "host_id",
                "workspace_id",
                "external_run_id",
                "status",
                "progress",
                "progress_message",
                "result_summary",
                "error",
                "is_adopted",
                "created_at",
                "started_at",
                "heartbeat_at",
                "completed_at",
                "cancel_requested_at",
                "updated_at",
            )
        },
        project_title=project.title if project else None,
        host_label=await execution_host_service.run_host_label(db, run),
        todo_id=task.todo_id,
        conversation_id=task.conversation_id,
        todo_title=todo.title if todo else None,
        todo_status=TaskStatus(todo.status) if todo else None,
        task_type=task.task_type,
        instruction=task.instruction,
        usage=usage,
    )


async def list_events(db: AsyncSession, run_id: str) -> list[AgentRunEventResponse]:
    await require_run(db, run_id)
    events = list(
        (
            await db.execute(
                select(AgentRunEvent)
                .where(AgentRunEvent.run_id == run_id)
                .order_by(AgentRunEvent.sequence.asc())
            )
        )
        .scalars()
        .all()
    )
    responses = []
    for event in events:
        payload = None
        if event.payload_json:
            try:
                payload = json.loads(event.payload_json)
            except (json.JSONDecodeError, TypeError):
                pass
        responses.append(
            AgentRunEventResponse(
                id=event.id,
                run_id=event.run_id,
                sequence=event.sequence,
                event_type=event.event_type,
                message=event.message,
                progress=event.progress,
                payload=payload,
                created_at=event.created_at,
            )
        )
    return responses


async def reconcile_interrupted_runs(db: AsyncSession) -> int:
    runs = list(
        (
            await db.execute(
                select(AgentRun).where(
                    AgentRun.status.in_(AGENT_RUN_EXECUTING_STATUSES)
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(timezone.utc)
    reconciled = 0
    for run in runs:
        # Paseo owns the external process. A later startup hook reattaches a
        # monitor instead of falsely declaring the still-running agent dead.
        if run.provider == "paseo" and run.external_run_id:
            continue
        reconciled += 1
        run.status = AgentRunStatus.FAILED
        run.error = "Execution interrupted by server restart; retry is available"
        run.completed_at = now
        task = await db.get(AgentTask, run.agent_task_id)
        if task is not None:
            task.status = "failed"
            task.error = run.error
            task.completed_at = now
        await record_event(db, run, "interrupted", run.error, progress=run.progress)
    return reconciled
