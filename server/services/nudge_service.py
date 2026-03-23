"""Proactive nudge service — surfaces forgotten/stale tasks with AI-generated suggestions."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from exceptions import AIUnavailableError
from models.todo import Todo
from services.ai_service import AIService

logger = logging.getLogger(__name__)


async def find_nudge_candidates(db: AsyncSession) -> list[dict]:
    """Find tasks that deserve a proactive nudge.

    Candidates:
    1. Pending tasks with no update in 3+ days
    2. Tasks due within 24 hours but still 'pending' (not started)
    3. Inbox items sitting for 2+ days
    """
    now = datetime.now(timezone.utc)
    candidates: list[dict] = []

    # 1. Stale tasks — pending, updated > 3 days ago, not inbox items
    stale_cutoff = now - timedelta(days=3)
    stale_q = (
        select(Todo)
        .where(
            Todo.status == "pending",
            Todo.updated_at < stale_cutoff,
            Todo.inbox_state.in_(["none", "captured"]),
        )
        .order_by(Todo.updated_at.asc())
        .limit(5)
    )
    stale_todos = (await db.execute(stale_q)).scalars().all()
    for t in stale_todos:
        days = (now - t.updated_at).days
        candidates.append({
            "todo_id": t.id,
            "title": t.title,
            "priority": t.priority,
            "reason": f"No activity for {days} days",
            "suggested_action": "break_down_or_reschedule",
            "urgency": 1,
        })

    # 2. Due soon but not started — due within 24h, still pending
    soon_cutoff = now + timedelta(hours=24)
    soon_q = (
        select(Todo)
        .where(
            Todo.status == "pending",
            Todo.due_date != None,  # noqa: E711
            Todo.due_date <= soon_cutoff,
            Todo.due_date > now,
        )
        .order_by(Todo.due_date.asc())
        .limit(5)
    )
    soon_todos = (await db.execute(soon_q)).scalars().all()
    for t in soon_todos:
        hours = max(1, int((t.due_date - now).total_seconds() / 3600))
        candidates.append({
            "todo_id": t.id,
            "title": t.title,
            "priority": t.priority,
            "reason": f"Due in {hours} hour{'s' if hours != 1 else ''} but not started",
            "suggested_action": "start_now",
            "urgency": 3 if t.priority in ("high", "urgent") else 2,
        })

    # 3. Inbox items sitting too long — created > 2 days ago, still in inbox
    inbox_cutoff = now - timedelta(days=2)
    inbox_q = (
        select(Todo)
        .where(
            Todo.inbox_state.in_(["captured", "classifying"]),
            Todo.created_at < inbox_cutoff,
        )
        .order_by(Todo.created_at.asc())
        .limit(3)
    )
    inbox_todos = (await db.execute(inbox_q)).scalars().all()
    for t in inbox_todos:
        days = (now - t.created_at).days
        candidates.append({
            "todo_id": t.id,
            "title": t.title,
            "priority": t.priority,
            "reason": f"Sitting in inbox for {days} days",
            "suggested_action": "organize",
            "urgency": 1,
        })

    # Sort by urgency descending
    candidates.sort(key=lambda c: c["urgency"], reverse=True)
    return candidates


async def generate_nudge(
    candidates: list[dict], ai_service: AIService
) -> dict | None:
    """Pick the most important candidate and generate a natural-language nudge.

    Returns {"title": str, "message": str, "todo_id": str, "suggested_action": str}
    or None if no candidates.
    """
    if not candidates:
        return None

    top = candidates[0]

    # Try LLM for natural language
    try:
        prompt = (
            f"Generate a brief, friendly nudge notification for a task:\n"
            f"Task: {top['title']}\n"
            f"Priority: {top['priority']}\n"
            f"Issue: {top['reason']}\n"
            f"Suggested action: {top['suggested_action']}\n\n"
            f"Respond with ONLY a single short sentence (under 100 chars) that gently reminds "
            f"the user about this task. Be warm but direct."
        )
        message = await ai_service.generate_completion(
            system_prompt="You are a helpful personal assistant. Generate brief, friendly nudge messages.",
            user_message=prompt,
        )
        message = message.strip().strip('"')
    except AIUnavailableError:
        # Fallback without LLM
        message = f"'{top['title']}' — {top['reason']}. Want to take action?"

    return {
        "title": "Nudge",
        "message": message,
        "todo_id": top["todo_id"],
        "suggested_action": top["suggested_action"],
    }
