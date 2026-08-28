"""Explicitly release unsuccessful Agent executions back to the task graph."""

from domain.agent_run import AGENT_RUN_ACTIVE_STATUSES, AgentRunStatus
from domain.review import ReviewStatus, ReviewSubjectType
from domain.task import TaskStatus
from exceptions import AppError, NotFoundError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from schemas.agent_run import AgentRunRecoveryResponse
from services import agent_run_service, graph_insights_service
from sqlalchemy import exists, literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession


async def _latest_run_id_for_todo(db: AsyncSession, todo_id: str) -> str | None:
    return (
        await db.execute(
            select(AgentRun.id)
            .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
            .where(AgentTask.todo_id == todo_id)
            .order_by(
                AgentRun.created_at.desc(),
                AgentRun.attempt.desc(),
                AgentRun.id.desc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()


def _latest_run_id_subquery(todo_id: str):
    return (
        select(AgentRun.id)
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(AgentTask.todo_id == todo_id)
        .order_by(
            AgentRun.created_at.desc(),
            AgentRun.attempt.desc(),
            AgentRun.id.desc(),
        )
        .limit(1)
        .scalar_subquery()
    )


def _active_run_exists(todo_id: str):
    return exists(
        select(AgentRun.id)
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(
            AgentTask.todo_id == todo_id,
            AgentRun.status.in_(AGENT_RUN_ACTIVE_STATUSES),
        )
    )


async def _is_unsuccessful_terminal(
    db: AsyncSession,
    run: AgentRun,
    task: AgentTask,
) -> bool:
    if run.status in {AgentRunStatus.FAILED, AgentRunStatus.CANCELLED}:
        return True
    if not (
        run.status == AgentRunStatus.COMPLETED
        and not run.is_adopted
        and task.status == "failed"
    ):
        return False
    rejected_review_id = (
        await db.execute(
            select(ReviewItem.id).where(
                ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
                ReviewItem.subject_id == run.id,
                ReviewItem.status == ReviewStatus.REJECTED,
            )
        )
    ).scalar_one_or_none()
    return rejected_review_id is not None


async def validate_retryable_run(
    db: AsyncSession,
    run: AgentRun,
    task: AgentTask,
) -> Todo | None:
    """Reject retries that would silently reopen completed work or fork attempts."""

    if not await _is_unsuccessful_terminal(db, run, task):
        raise AppError(
            code="AGENT_RUN_NOT_RETRYABLE",
            message="Only the latest unsuccessful run can be retried",
            status_code=409,
            details={"run_id": run.id},
        )
    if task.todo_id is None:
        return None

    todo = await db.get(Todo, task.todo_id)
    if todo is None:
        raise NotFoundError("Task linked to this agent run was not found")
    if todo.status != TaskStatus.IN_PROGRESS:
        raise AppError(
            code="TASK_EXECUTION_STATE_CONFLICT",
            message="Only an In Progress task can retry or release an unsuccessful run",
            status_code=409,
            details={"run_id": run.id, "task_id": todo.id, "status": todo.status},
        )
    latest_run_id = await _latest_run_id_for_todo(db, todo.id)
    if latest_run_id != run.id:
        raise AppError(
            code="AGENT_RUN_SUPERSEDED",
            message="A newer agent run already exists for this task",
            status_code=409,
            details={"run_id": run.id, "latest_run_id": latest_run_id},
        )
    active_run_id = (
        await db.execute(
            select(AgentRun.id)
            .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
            .where(
                AgentTask.todo_id == todo.id,
                AgentRun.status.in_(AGENT_RUN_ACTIVE_STATUSES),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if active_run_id is not None:
        raise AppError(
            code="TASK_EXECUTION_ACTIVE",
            message="This task already has an active agent run",
            status_code=409,
            details={"task_id": todo.id, "run_id": active_run_id},
        )
    return todo


async def return_task_to_ready(
    db: AsyncSession,
    run_id: str,
) -> AgentRunRecoveryResponse:
    """Return the latest unsuccessful Todo-backed run to canonical pending state."""

    run = await agent_run_service.require_run(db, run_id)
    task = await db.get(AgentTask, run.agent_task_id)
    if task is None:
        raise NotFoundError("Agent task not found")
    todo = await validate_retryable_run(db, run, task)
    if todo is None:
        raise AppError(
            code="AGENT_RUN_NOT_TODO_BACKED",
            message="Only task-backed agent runs can return to Ready",
            status_code=409,
            details={"run_id": run.id},
        )

    claimed = await db.execute(
        update(Todo)
        .where(
            Todo.id == todo.id,
            Todo.status == TaskStatus.IN_PROGRESS,
            literal(run.id) == _latest_run_id_subquery(todo.id),
            ~_active_run_exists(todo.id),
        )
        .values(status=TaskStatus.PENDING, completed_at=None)
    )
    if claimed.rowcount != 1:
        raise AppError(
            code="TASK_RECOVERY_CONFLICT",
            message="The task changed before it could return to Ready",
            status_code=409,
            details={"task_id": todo.id},
        )
    await agent_run_service.record_event(
        db,
        run,
        "returned_to_ready",
        "Task returned to the execution queue",
        progress=run.progress,
    )
    await db.flush()

    root_task_id = None
    if todo.project_id is not None:
        root_task_id = (
            await db.execute(
                select(Project.root_task_id).where(Project.id == todo.project_id)
            )
        ).scalar_one_or_none()
    insights = await graph_insights_service.get_graph_insights(
        db,
        root_task_id=root_task_id,
    )
    insight = next(
        (node for node in insights.nodes if node.task_id == todo.id),
        None,
    )
    if insight is None:
        raise AppError(
            code="TASK_GRAPH_UNAVAILABLE",
            message="The recovered task is not available in the execution graph",
            status_code=409,
            details={"task_id": todo.id},
        )
    return AgentRunRecoveryResponse(
        run_id=run.id,
        todo_id=todo.id,
        todo_status=TaskStatus.PENDING,
        graph_revision=insights.graph_revision,
        execution_state=insight.execution_state,
        is_ready=insight.is_ready,
        direct_blocker_ids=insight.direct_blocker_ids,
    )


async def claim_retryable_run(
    db: AsyncSession,
    run: AgentRun,
    task: AgentTask,
) -> None:
    """Serialize Retry against recovery and other attempts for one Todo."""

    if task.todo_id is None:
        return
    claimed = await db.execute(
        update(Todo)
        .where(
            Todo.id == task.todo_id,
            Todo.status == TaskStatus.IN_PROGRESS,
            literal(run.id) == _latest_run_id_subquery(task.todo_id),
            ~_active_run_exists(task.todo_id),
        )
        .values(status=TaskStatus.IN_PROGRESS)
    )
    if claimed.rowcount != 1:
        raise AppError(
            code="TASK_RETRY_CONFLICT",
            message="The task changed before a new agent attempt could start",
            status_code=409,
            details={"task_id": task.todo_id, "run_id": run.id},
        )
