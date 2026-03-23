"""Async service for generating daily briefings."""

import json
import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from exceptions import AIUnavailableError
from models.agent_task import AgentTask
from models.event import Event
from models.todo import Todo
from services.ai_service import AIService

logger = logging.getLogger(__name__)


async def gather_briefing_data(db: AsyncSession) -> dict:
    today = date.today()
    today_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    today_end = datetime.combine(today, time.max, tzinfo=timezone.utc)
    upcoming_end = datetime.combine(today + timedelta(days=3), time.max, tzinfo=timezone.utc)

    # Today's events
    events_q = (
        select(Event)
        .where(Event.start_time >= today_start, Event.start_time <= today_end)
        .order_by(Event.start_time.asc())
    )
    events = list((await db.execute(events_q)).scalars().all())

    # Upcoming events (next 3 days, excluding today)
    upcoming_events_q = (
        select(Event)
        .where(Event.start_time > today_end, Event.start_time <= upcoming_end)
        .order_by(Event.start_time.asc())
    )
    upcoming_events = list((await db.execute(upcoming_events_q)).scalars().all())

    # Pending todos due today
    pending_q = (
        select(Todo)
        .where(
            Todo.due_date >= today_start,
            Todo.due_date <= today_end,
            Todo.status.notin_(["completed", "cancelled"]),
        )
        .order_by(Todo.created_at.asc())
    )
    pending_todos = list((await db.execute(pending_q)).scalars().all())

    # Upcoming todos (next 3 days)
    upcoming_todos_q = (
        select(Todo)
        .where(
            Todo.due_date > today_end,
            Todo.due_date <= upcoming_end,
            Todo.status.notin_(["completed", "cancelled"]),
        )
        .order_by(Todo.due_date.asc())
    )
    upcoming_todos = list((await db.execute(upcoming_todos_q)).scalars().all())

    # Overdue todos
    overdue_q = (
        select(Todo)
        .where(
            Todo.due_date < today_start,
            Todo.status.in_(["pending", "in_progress"]),
        )
        .order_by(Todo.due_date.asc())
    )
    overdue_todos = list((await db.execute(overdue_q)).scalars().all())

    # In-progress tasks (not due today)
    in_progress_q = select(Todo).where(
        Todo.status == "in_progress",
        or_(
            Todo.due_date == None,  # noqa: E711
            Todo.due_date < today_start,
            Todo.due_date > today_end,
        ),
    )
    in_progress = list((await db.execute(in_progress_q)).scalars().all())

    # High/urgent priority tasks due today or overdue
    high_priority_count = sum(
        1 for t in pending_todos + overdue_todos if t.priority in ("high", "urgent")
    )

    # Inbox count (no due date, pending)
    inbox_q = select(func.count(Todo.id)).where(
        Todo.due_date == None,  # noqa: E711
        Todo.status == "pending",
    )
    inbox_count = (await db.execute(inbox_q)).scalar() or 0

    # Running agent tasks
    agent_q = select(AgentTask).where(AgentTask.status.in_(["queued", "running"]))
    agent_tasks = list((await db.execute(agent_q)).scalars().all())

    return {
        "events": events,
        "upcoming_events": upcoming_events,
        "pending_todos": pending_todos,
        "upcoming_todos": upcoming_todos,
        "overdue_todos": overdue_todos,
        "in_progress": in_progress,
        "high_priority_count": high_priority_count,
        "inbox_count": inbox_count,
        "agent_tasks": agent_tasks,
        "date": today,
    }


def _format_briefing_prompt(data: dict) -> str:
    lines = [f"Today is {data['date'].strftime('%A, %B %d, %Y')}."]
    lines.append("")

    if data["events"]:
        lines.append("## Today's Events")
        for e in data["events"]:
            t = e.start_time.strftime("%H:%M") if e.start_time else "all day"
            lines.append(f"- {t}: {e.title}" + (f" @ {e.location}" if e.location else ""))
        lines.append("")

    if data["pending_todos"]:
        lines.append("## Tasks Due Today")
        for t in data["pending_todos"]:
            lines.append(f"- [{t.priority}] {t.title} (id: {t.id})")
        lines.append("")

    if data["overdue_todos"]:
        lines.append("## Overdue Tasks")
        for t in data["overdue_todos"]:
            due = t.due_date.strftime("%b %d") if t.due_date else "unknown"
            lines.append(f"- {t.title} (was due {due}, id: {t.id})")
        lines.append("")

    if data["in_progress"]:
        lines.append("## In Progress")
        for t in data["in_progress"]:
            lines.append(f"- {t.title} (id: {t.id})")
        lines.append("")

    if data.get("upcoming_todos"):
        lines.append("## Upcoming (next 3 days)")
        for t in data["upcoming_todos"][:5]:
            due = t.due_date.strftime("%b %d") if t.due_date else ""
            lines.append(f"- [{t.priority}] {t.title} (due {due})")
        lines.append("")

    if data.get("upcoming_events"):
        lines.append("## Upcoming Events (next 3 days)")
        for e in data["upcoming_events"][:5]:
            t = e.start_time.strftime("%a %H:%M") if e.start_time else "all day"
            lines.append(f"- {t}: {e.title}")
        lines.append("")

    if data["inbox_count"] > 0:
        lines.append(f"Inbox: {data['inbox_count']} unsorted task(s).")
        lines.append("")

    if data["agent_tasks"]:
        lines.append(f"Background tasks: {len(data['agent_tasks'])} queued/running.")
        lines.append("")

    total_items = len(data["events"]) + len(data["pending_todos"]) + len(data["overdue_todos"])
    lines.append(f"Load: {len(data['events'])} meetings + {len(data['pending_todos'])} tasks due + {len(data['overdue_todos'])} overdue. High/urgent items: {data.get('high_priority_count', 0)}.")

    return "\n".join(lines)


_BRIEFING_SYSTEM_PROMPT = """\
You are a personal assistant generating an actionable daily briefing.
Analyze the user's schedule and tasks, then respond with ONLY a JSON object (no markdown fences):

{
  "summary": "2-3 sentence friendly overview of the day",
  "highlights": ["key point 1", "key point 2", "..."],
  "suggestions": [
    {"action": "start_with", "todo_id": "...", "title": "...", "reason": "..."},
    {"action": "move_to_tomorrow", "todo_id": "...", "title": "...", "reason": "..."},
    {"action": "reschedule", "todo_id": "...", "title": "...", "reason": "..."}
  ],
  "load_assessment": "light|moderate|heavy",
  "load_message": "Short description of day's intensity"
}

Rules:
- "start_with": suggest the most important task to start the day with
- "move_to_tomorrow": suggest moving a lower-priority task if the day is heavy
- Only include suggestions that reference actual todo_ids from the data
- Keep suggestions to 1-3 items max
- load_assessment: "light" (0-3 items), "moderate" (4-7), "heavy" (8+)
- Always respond with valid JSON only"""


async def generate_briefing(db: AsyncSession, ai_service: AIService) -> dict:
    data = await gather_briefing_data(db)

    stats = {
        "events": len(data["events"]),
        "tasks_due": len(data["pending_todos"]),
        "overdue": len(data["overdue_todos"]),
        "in_progress": len(data["in_progress"]),
        "inbox": data["inbox_count"],
        "agent_tasks": len(data["agent_tasks"]),
        "high_priority": data.get("high_priority_count", 0),
        "upcoming_tasks": len(data.get("upcoming_todos", [])),
        "upcoming_events": len(data.get("upcoming_events", [])),
    }

    # Nothing to brief
    has_items = any(v > 0 for v in stats.values())
    if not has_items:
        return {
            "summary": "Your schedule is clear today. No tasks, events, or pending items.",
            "stats": stats,
            "suggestions": [],
            "load_assessment": "light",
            "load_message": "Nothing on the agenda today.",
        }

    prompt_text = _format_briefing_prompt(data)

    try:
        raw = await ai_service.generate_completion(
            system_prompt=_BRIEFING_SYSTEM_PROMPT,
            user_message=prompt_text,
        )
        # Try parsing as JSON for structured response
        parsed = _parse_briefing_json(raw)
        if parsed:
            return {
                "summary": parsed.get("summary", raw),
                "highlights": parsed.get("highlights", []),
                "suggestions": parsed.get("suggestions", []),
                "load_assessment": parsed.get("load_assessment", "moderate"),
                "load_message": parsed.get("load_message", ""),
                "stats": stats,
            }
        # Fallback: LLM didn't return valid JSON
        return {
            "summary": raw,
            "stats": stats,
            "suggestions": [],
            "load_assessment": _compute_load(stats),
            "load_message": "",
        }
    except AIUnavailableError:
        logger.warning("LLM unavailable for briefing, using plain text fallback")
        return {
            "summary": _format_briefing_prompt(data),
            "stats": stats,
            "suggestions": [],
            "load_assessment": _compute_load(stats),
            "load_message": "",
        }


def _parse_briefing_json(raw: str) -> dict | None:
    """Try to parse the LLM response as JSON. Strip markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        # Remove markdown code fences
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


def _compute_load(stats: dict) -> str:
    """Compute load assessment from stats when LLM is unavailable."""
    total = stats.get("events", 0) + stats.get("tasks_due", 0) + stats.get("overdue", 0)
    if total <= 3:
        return "light"
    if total <= 7:
        return "moderate"
    return "heavy"
