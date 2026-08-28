"""Deterministic Todo handoff calculations for Agent Run reviews."""

from domain.task import TaskStatus
from models.project import Project
from models.todo import Todo
from schemas.graph_insights import GraphInsightsResponse
from schemas.review import AgentRunApprovalImpact, ReadyTaskReference
from services import graph_insights_service
from services.graph_command_service import current_graph_revision
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def load_todo_graph_insights(
    db: AsyncSession,
    todo: Todo,
) -> GraphInsightsResponse:
    """Load the same project-scoped snapshot used by Ready-only execution."""

    root_task_id = None
    if todo.project_id is not None:
        root_task_id = (
            await db.execute(
                select(Project.root_task_id).where(Project.id == todo.project_id)
            )
        ).scalar_one_or_none()
    return await graph_insights_service.get_graph_insights(
        db,
        root_task_id=root_task_id,
    )


def predicted_newly_ready_tasks(
    todo: Todo,
    insights: GraphInsightsResponse,
) -> list[ReadyTaskReference]:
    """Return tasks that completion of ``todo`` alone would release.

    Canonical readiness is defined by Graph Insights. Completing one Todo can
    only remove that Todo from another pending leaf's direct blockers, so a
    node is newly Ready exactly when it currently has this Todo as its sole
    direct blocker.
    """

    if todo.status == TaskStatus.COMPLETED:
        return []
    return [
        ReadyTaskReference(id=node.task_id, title=node.title)
        for node in insights.nodes
        if node.status == TaskStatus.PENDING
        and not node.is_container
        and not node.is_ready
        and node.direct_blocker_ids == [todo.id]
    ]


async def build_approval_impact(
    db: AsyncSession,
    todo: Todo | None,
) -> AgentRunApprovalImpact:
    """Build a read-only approval preview without changing task state."""

    if todo is None:
        return AgentRunApprovalImpact(
            todo_id=None,
            graph_revision=await current_graph_revision(db),
        )
    insights = await load_todo_graph_insights(db, todo)
    return AgentRunApprovalImpact(
        todo_id=todo.id,
        graph_revision=insights.graph_revision,
        newly_ready_tasks=predicted_newly_ready_tasks(todo, insights),
    )


def newly_ready_after_approval(
    before: GraphInsightsResponse,
    after: GraphInsightsResponse,
) -> list[ReadyTaskReference]:
    """Return deterministic Ready transitions between revision snapshots."""

    ready_before = {node.task_id for node in before.nodes if node.is_ready}
    return [
        ReadyTaskReference(id=node.task_id, title=node.title)
        for node in after.nodes
        if node.is_ready and node.task_id not in ready_before
    ]
