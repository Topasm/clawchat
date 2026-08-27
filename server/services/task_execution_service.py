"""Guard explicit single-task execution against the canonical graph state."""

from domain.agent_run import AGENT_RUN_ACTIVE_STATUSES
from domain.task import TaskStatus
from exceptions import AppError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.todo import Todo
from services import graph_insights_service
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession


async def validate_ready_execution(db: AsyncSession, todo: Todo) -> None:
    """Fail closed unless a Task is an actionable Ready leaf with no active Run."""

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
    if insight is None or not insight.is_ready:
        raise AppError(
            code="TASK_NOT_READY",
            message="Only a Ready task can start an agent run",
            status_code=409,
            details={
                "task_id": todo.id,
                "graph_revision": insights.graph_revision,
                "execution_state": (
                    insight.execution_state.value if insight is not None else "unavailable"
                ),
                "is_container": insight.is_container if insight is not None else False,
                "direct_blocker_ids": (
                    insight.direct_blocker_ids if insight is not None else []
                ),
            },
        )

async def claim_ready_execution(db: AsyncSession, todo_id: str) -> None:
    """Atomically transition pending to in-progress so concurrent starts cannot win."""

    result = await db.execute(
        update(Todo)
        .where(Todo.id == todo_id, Todo.status == TaskStatus.PENDING)
        .values(status=TaskStatus.IN_PROGRESS, completed_at=None)
    )
    if result.rowcount != 1:
        raise AppError(
            code="TASK_EXECUTION_CONFLICT",
            message="The task changed before the agent run could start",
            status_code=409,
            details={"task_id": todo_id},
        )
