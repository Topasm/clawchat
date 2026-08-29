"""Shared revision and deterministic-impact helpers for graph commands."""

from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID
from exceptions import ConflictError, ValidationError
from models.task_graph_state import TaskGraphState
from schemas.graph_insights import GraphInsightsResponse
from services.tasks import graph_insights_service


async def current_graph_revision(db: AsyncSession) -> int:
    revision = (
        await db.execute(
            select(TaskGraphState.revision).where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID
            )
        )
    ).scalar_one_or_none()
    return revision or 0


async def claim_graph_revision(db: AsyncSession, expected: int) -> None:
    claimed = (
        await db.execute(
            update(TaskGraphState)
            .where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID,
                TaskGraphState.revision == expected,
            )
            .values(revision=TaskGraphState.revision)
            .returning(TaskGraphState.revision)
        )
    ).scalar_one_or_none()
    if claimed is None:
        current = await current_graph_revision(db)
        raise ConflictError(
            f"Task graph changed from revision {expected} to {current}; refresh and retry",
            details={"expected_graph_revision": expected, "current_graph_revision": current},
        )


async def ensure_graph_revision_advanced(db: AsyncSession, previous: int) -> int:
    """Advance commands whose only changes sit outside graph revision triggers."""
    current = await current_graph_revision(db)
    if current != previous:
        return current
    advanced = (
        await db.execute(
            update(TaskGraphState)
            .where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID,
                TaskGraphState.revision == previous,
            )
            .values(
                revision=TaskGraphState.revision + 1,
                updated_at=datetime.now(timezone.utc),
            )
            .returning(TaskGraphState.revision)
        )
    ).scalar_one_or_none()
    if advanced is None:
        current = await current_graph_revision(db)
        raise ConflictError(
            f"Task graph changed from revision {previous} to {current}; refresh and retry",
            details={"expected_graph_revision": previous, "current_graph_revision": current},
        )
    return advanced


async def load_graph_insights(
    db: AsyncSession,
    *,
    generated_at: datetime | None = None,
) -> GraphInsightsResponse | None:
    try:
        return await graph_insights_service.get_graph_insights(
            db,
            generated_at=generated_at,
        )
    except ValidationError:
        return None


def insight_delta(
    before: GraphInsightsResponse | None,
    after: GraphInsightsResponse | None,
) -> dict[str, int | None] | None:
    if before is None or after is None:
        return None
    before_critical = before.summary.critical_path_minutes
    after_critical = after.summary.critical_path_minutes
    return {
        "ready_count": after.summary.ready_count - before.summary.ready_count,
        "blocked_count": after.summary.blocked_count - before.summary.blocked_count,
        "critical_path_minutes": (
            after_critical - before_critical
            if after_critical is not None and before_critical is not None
            else None
        ),
    }


def changed_graph_task_ids(
    before: GraphInsightsResponse | None,
    after: GraphInsightsResponse | None,
) -> list[str]:
    if before is None or after is None:
        return []
    before_by_id = {node.task_id: node for node in before.nodes}
    after_by_id = {node.task_id: node for node in after.nodes}
    return sorted(
        task_id
        for task_id in before_by_id.keys() | after_by_id.keys()
        if before_by_id.get(task_id) != after_by_id.get(task_id)
    )
