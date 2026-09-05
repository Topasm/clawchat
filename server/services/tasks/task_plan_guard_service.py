"""Protect an active execution's task structure from plan mutations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.agent_run import AGENT_RUN_ACTIVE_STATUSES
from exceptions import AppError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.todo import Todo

ACTIVE_PLAN_MESSAGE = (
    "This change affects a task with an active agent run. Stop the run before "
    "changing its prerequisites or splitting or moving the task. "
    "You can add a follow-up task under the same parent without changing this run."
)


async def active_plan_run(db: AsyncSession, task_ids: list[str]) -> str | None:
    if not task_ids:
        return None
    return (
        await db.execute(
            select(AgentRun.id)
            .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
            .where(
                AgentTask.todo_id.in_(task_ids),
                AgentRun.status.in_(AGENT_RUN_ACTIVE_STATUSES),
            )
            .order_by(AgentRun.id)
            .limit(1)
        )
    ).scalar_one_or_none()


async def require_editable_plan(
    db: AsyncSession,
    task_ids: list[str],
    *,
    message: str = ACTIVE_PLAN_MESSAGE,
) -> None:
    run_id = await active_plan_run(db, task_ids)
    if run_id is not None:
        raise AppError(
            code="TASK_PLAN_ACTIVE_RUN",
            message=message,
            status_code=409,
            details={"task_ids": task_ids, "run_id": run_id},
        )


async def require_editable_branch(db: AsyncSession, task_id: str) -> None:
    branch = select(Todo.id).where(Todo.id == task_id).cte(recursive=True)
    branch = branch.union(select(Todo.id).join(branch, Todo.parent_id == branch.c.id))
    task_ids = list((await db.execute(select(branch.c.id))).scalars())
    await require_editable_plan(db, task_ids)
