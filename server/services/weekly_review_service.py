"""Weekly review service — gathers data and generates AI-powered GTD review."""

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from exceptions import AIUnavailableError
from models.todo import Todo
from services.ai_service import AIService

logger = logging.getLogger(__name__)


async def gather_review_data(db: AsyncSession) -> dict:
    """Gather all data needed for a GTD-style weekly review."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    week_ahead = now + timedelta(days=7)

    # Completed this week
    completed_q = (
        select(Todo)
        .where(
            Todo.status == "completed",
            Todo.completed_at >= week_ago,
        )
        .order_by(Todo.completed_at.desc())
    )
    completed = list((await db.execute(completed_q)).scalars().all())

    # Stale tasks — pending, no update in 7+ days
    stale_q = (
        select(Todo)
        .where(
            Todo.status.in_(["pending", "in_progress"]),
            Todo.updated_at < week_ago,
        )
        .order_by(Todo.updated_at.asc())
        .limit(20)
    )
    stale = list((await db.execute(stale_q)).scalars().all())

    # Upcoming deadlines — next 7 days
    upcoming_q = (
        select(Todo)
        .where(
            Todo.due_date != None,  # noqa: E711
            Todo.due_date <= week_ahead,
            Todo.due_date > now,
            Todo.status.notin_(["completed", "cancelled"]),
        )
        .order_by(Todo.due_date.asc())
    )
    upcoming = list((await db.execute(upcoming_q)).scalars().all())

    # Overdue
    overdue_q = (
        select(Todo)
        .where(
            Todo.due_date < now,
            Todo.status.in_(["pending", "in_progress"]),
        )
        .order_by(Todo.due_date.asc())
    )
    overdue = list((await db.execute(overdue_q)).scalars().all())

    # Inbox items
    inbox_q = (
        select(Todo)
        .where(
            Todo.inbox_state.in_(["captured", "classifying", "none"]),
            Todo.due_date == None,  # noqa: E711
            Todo.status == "pending",
        )
        .order_by(Todo.created_at.asc())
        .limit(20)
    )
    inbox = list((await db.execute(inbox_q)).scalars().all())

    # Total counts
    total_q = select(func.count(Todo.id)).where(
        Todo.status.notin_(["completed", "cancelled"])
    )
    total_open = (await db.execute(total_q)).scalar() or 0

    return {
        "completed": completed,
        "stale": stale,
        "upcoming": upcoming,
        "overdue": overdue,
        "inbox": inbox,
        "total_open": total_open,
        "week_start": week_ago,
        "week_end": now,
    }


def _format_review_prompt(data: dict) -> str:
    """Format review data into a prompt for the LLM."""
    lines = [
        f"## Weekly Review Data",
        f"Period: {data['week_start'].strftime('%b %d')} - {data['week_end'].strftime('%b %d, %Y')}",
        f"Total open tasks: {data['total_open']}",
        "",
    ]

    if data["completed"]:
        lines.append(f"### Completed This Week ({len(data['completed'])})")
        for t in data["completed"][:10]:
            lines.append(f"- {t.title}")
        lines.append("")

    if data["stale"]:
        lines.append(f"### Stale Tasks (no update 7+ days) ({len(data['stale'])})")
        for t in data["stale"]:
            days = (data["week_end"] - t.updated_at).days
            lines.append(f"- [{t.priority}] {t.title} (id: {t.id}, stale {days}d)")
        lines.append("")

    if data["overdue"]:
        lines.append(f"### Overdue ({len(data['overdue'])})")
        for t in data["overdue"]:
            due = t.due_date.strftime("%b %d") if t.due_date else "?"
            lines.append(f"- [{t.priority}] {t.title} (id: {t.id}, was due {due})")
        lines.append("")

    if data["upcoming"]:
        lines.append(f"### Upcoming Deadlines ({len(data['upcoming'])})")
        for t in data["upcoming"]:
            due = t.due_date.strftime("%b %d") if t.due_date else "?"
            lines.append(f"- [{t.priority}] {t.title} (due {due})")
        lines.append("")

    if data["inbox"]:
        lines.append(f"### Inbox ({len(data['inbox'])})")
        for t in data["inbox"][:10]:
            lines.append(f"- {t.title} (id: {t.id})")
        lines.append("")

    return "\n".join(lines)


_REVIEW_SYSTEM_PROMPT = """\
You are a personal assistant conducting a GTD-style weekly review.
Analyze the data and respond with ONLY a JSON object (no markdown fences):

{
  "content": "Full review in markdown with sections: Wins, Attention Needed, Upcoming, Inbox",
  "suggestions": [
    {"action": "archive|reschedule|break_down|prioritize", "todo_id": "...", "title": "...", "reason": "..."}
  ],
  "stats": {
    "completed_count": 0,
    "stale_count": 0,
    "overdue_count": 0,
    "inbox_count": 0
  }
}

Rules:
- Only reference actual todo_ids from the data
- Limit suggestions to the 5 most impactful actions
- Be encouraging about completed work
- Be direct about stale/overdue items needing attention
- Always respond with valid JSON only"""


async def generate_weekly_review(
    db: AsyncSession, ai_service: AIService
) -> dict:
    """Generate a structured weekly review using the LLM."""
    data = await gather_review_data(db)

    stats = {
        "completed_count": len(data["completed"]),
        "stale_count": len(data["stale"]),
        "overdue_count": len(data["overdue"]),
        "inbox_count": len(data["inbox"]),
        "total_open": data["total_open"],
    }

    prompt = _format_review_prompt(data)

    try:
        raw = await ai_service.generate_completion(
            system_prompt=_REVIEW_SYSTEM_PROMPT,
            user_message=prompt,
        )
        parsed = _parse_review_json(raw)
        if parsed:
            return {
                "content": parsed.get("content", raw),
                "suggestions": parsed.get("suggestions", []),
                "stats": parsed.get("stats", stats),
            }
        return {"content": raw, "suggestions": [], "stats": stats}
    except AIUnavailableError:
        logger.warning("LLM unavailable for weekly review, using plain text")
        return {"content": prompt, "suggestions": [], "stats": stats}


def _parse_review_json(raw: str) -> dict | None:
    """Try to parse LLM response as JSON."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
