"""A bounded, plain-text picture of the user's tasks for a scheduled job.

This is what lets a job answer "what's blocked?" or "draft this week's status"
from the real task graph instead of from a bare prompt.
"""

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from domain.graph_insights import GraphDueRisk, GraphScopeRole
from domain.task import TaskStatus
from exceptions import ValidationError
from models.project import Project
from models.todo import Todo
from schemas.graph_insights import GraphInsightNode
from services.tasks.graph_insights_service import get_graph_insights
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_ITEMS_PER_SECTION = 15
DEFAULT_LOOKBACK = timedelta(days=7)


def _when(moment: datetime | None, zone: ZoneInfo) -> str:
    if moment is None:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(zone).strftime("%a %Y-%m-%d %H:%M")


def _section(title: str, lines: list[str]) -> list[str]:
    if not lines:
        return []
    shown = lines[:MAX_ITEMS_PER_SECTION]
    extra = len(lines) - len(shown)
    tail = [f"- …and {extra} more"] if extra else []
    return [f"## {title} ({len(lines)})", *shown, *tail, ""]


def _line(node: GraphInsightNode, zone: ZoneInfo, *, suffix: str = "") -> str:
    due = f" (due {_when(node.due_date, zone)})" if node.due_date else ""
    return f"- {node.title}{due}{suffix}"


def _titles(ids: Iterable[str], titles: dict[str, str]) -> str:
    return ", ".join(titles.get(task_id, task_id) for task_id in ids)


async def build_task_snapshot(
    db: AsyncSession,
    *,
    project: Project | None,
    since: datetime | None,
    zone: ZoneInfo,
    now: datetime | None = None,
) -> str:
    """Summarize open work, blockers, deadlines, and recent completions."""
    now = now or datetime.now(timezone.utc)
    since = since or now - DEFAULT_LOOKBACK
    scope = f'project "{project.title}"' if project else "all tasks"
    header = f"# Task snapshot: {scope}, as of {_when(now, zone)}"
    if project is not None and project.root_task_id is None:
        return f"{header}\n\nThis project has no tasks yet."
    try:
        insights = await get_graph_insights(
            db,
            root_task_id=project.root_task_id if project else None,
            generated_at=now,
        )
    except ValidationError:
        return f"{header}\n\nThere are too many tasks to summarize here."

    titles = {node.task_id: node.title for node in insights.nodes}
    # Context nodes are outside prerequisites: named as blockers, not listed.
    work = [
        node
        for node in insights.nodes
        if node.scope_role != GraphScopeRole.CONTEXT
        and node.scope_role != GraphScopeRole.ROOT
        and not node.is_container
    ]

    in_progress = [
        _line(node, zone) for node in work if node.status == TaskStatus.IN_PROGRESS
    ]
    ready = [_line(node, zone) for node in work if node.is_ready]
    blocked = [
        _line(
            node,
            zone,
            suffix=f" — waiting on: {_titles(node.direct_blocker_ids, titles)}"
            if node.direct_blocker_ids
            else "",
        )
        for node in work
        if node.is_blocked
    ]
    overdue = [
        _line(node, zone) for node in work if node.due_risk == GraphDueRisk.OVERDUE
    ]
    at_risk = [
        _line(node, zone)
        for node in work
        if node.due_risk in {GraphDueRisk.BLOCKED, GraphDueRisk.INSUFFICIENT_TIME}
    ]

    completed_rows = (
        await db.execute(
            select(Todo.title, Todo.completed_at)
            .where(
                Todo.id.in_([node.task_id for node in work]),
                Todo.status == TaskStatus.COMPLETED,
                Todo.completed_at >= since,
            )
            .order_by(Todo.completed_at.desc())
        )
    ).all()
    completed = [f"- {title} ({_when(done, zone)})" for title, done in completed_rows]

    summary = insights.summary
    lines = [
        header,
        "",
        (
            f"{summary.active_count} open: {summary.in_progress_count} in progress, "
            f"{summary.ready_count} ready, {summary.blocked_count} blocked, "
            f"{summary.overdue_count} overdue, {summary.at_risk_count} at risk."
        ),
        "",
        *_section("In progress", in_progress),
        *_section("Ready to start", ready),
        *_section("Blocked", blocked),
        *_section("Overdue", overdue),
        *_section("At risk of missing the due date", at_risk),
        *_section(f"Completed since {_when(since, zone)}", completed),
    ]
    return "\n".join(lines).rstrip()
