"""A bounded, plain-text picture of the user's tasks for a scheduled job.

This is what lets a job answer "what's blocked?" or "draft this week's status"
from the real task graph instead of from a bare prompt.
"""

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from domain.graph_insights import GraphDueRisk
from domain.task import TaskStatus
from exceptions import ValidationError
from models.project import Project
from models.todo import Todo
from schemas.graph_insights import GraphInsightNode
from services.tasks.graph_insights_service import get_graph_insights, project_work_insights
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
    try:
        if project is not None:
            insights, work = await project_work_insights(
                db,
                project_id=project.id,
                root_task_id=project.root_task_id,
                generated_at=now,
            )
        else:
            insights = await get_graph_insights(db, generated_at=now)
            # A project's root stands for the project, not a piece of work.
            roots = set(
                (
                    await db.execute(
                        select(Project.root_task_id).where(Project.root_task_id.isnot(None))
                    )
                ).scalars()
            )
            work = [
                node
                for node in insights.nodes
                if not node.is_container and node.task_id not in roots
            ]
    except ValidationError:
        return f"{header}\n\nThere are too many tasks to summarize here."

    titles = {node.task_id: node.title for node in insights.nodes}

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

    open_work = [
        node for node in work if node.status in (TaskStatus.PENDING, TaskStatus.IN_PROGRESS)
    ]
    lines = [
        header,
        "",
        (
            f"{len(open_work)} open: {len(in_progress)} in progress, "
            f"{len(ready)} ready, {len(blocked)} blocked, "
            f"{len(overdue)} overdue, {len(at_risk)} at risk."
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
