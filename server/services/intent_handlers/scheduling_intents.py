"""Scheduling intents: suggest a time, check conflicts, analyze the week."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services import calendar_service, scheduling_service
from services.intent_handlers import (
    IntentContext,
    IntentHandlerDef,
    IntentReply,
    register_intent_handler,
)

_ANALYST_PROMPT = (
    "You are a scheduling analyst. Summarize the user's week concisely — "
    "highlight busy days, free days, and any potential issues like "
    "back-to-back meetings."
)


async def suggest_time(ctx: IntentContext) -> IntentReply:
    params = ctx.params
    title = params.get("title", "Meeting")
    duration = params.get("duration", 60)
    preferred = None
    if params.get("preferred_date"):
        preferred = datetime.fromisoformat(params["preferred_date"])
    suggestions = await scheduling_service.suggest_best_time(
        ctx.db, ctx.ai, title, int(duration), preferred,
    )
    if not suggestions:
        return "I couldn't find any available time slots in the next week. Your schedule looks quite full!", None
    lines = [f"Here are my top suggestions for '{title}':"]
    for i, s in enumerate(suggestions, 1):
        start_dt = datetime.fromisoformat(s["start"])
        lines.append(f"{i}. {start_dt.strftime('%A, %b %d at %I:%M %p')} — {s.get('reason', '')}")
    lines.append("\nJust say 'schedule it at [time]' to create the event.")
    return (
        "\n".join(lines),
        {"action_type": "scheduling_suggestions", "suggestions": suggestions, "title": title},
    )


async def check_conflicts(ctx: IntentContext) -> IntentReply:
    params = ctx.params
    start_time = params.get("start_time")
    if not start_time:
        now = datetime.now(timezone.utc)
        start_time = now.isoformat()
    st = datetime.fromisoformat(start_time)
    end_time = params.get("end_time")
    et = datetime.fromisoformat(end_time) if end_time else st + timedelta(hours=1)
    conflicts = await scheduling_service.find_conflicts(ctx.db, st, et)
    if not conflicts:
        return (
            "You're free during that time! No scheduling conflicts found.",
            {"action_type": "no_conflicts"},
        )
    lines = [f"You have {len(conflicts)} conflict(s):"]
    for c in conflicts:
        lines.append(f"- {c['title']} ({c['start_time']})")
    return (
        "\n".join(lines),
        {"action_type": "conflicts_found", "conflicts": conflicts},
    )


async def analyze_schedule(ctx: IntentContext) -> IntentReply:
    now = datetime.now(timezone.utc)
    range_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    range_end = range_start + timedelta(days=7)
    events, total = await calendar_service.get_events(
        ctx.db, start_after=range_start, start_before=range_end, limit=100
    )
    if not events:
        return "Your schedule for the next 7 days is completely clear!", None
    # Build summary for AI
    event_lines = []
    for e in events:
        t = e["title"] if isinstance(e, dict) else e.title
        st = e["start_time"] if isinstance(e, dict) else e.start_time
        event_lines.append(f"- {t} at {st}")
    event_summary = "\n".join(event_lines)
    analysis = await ctx.ai.generate_completion(
        system_prompt=_ANALYST_PROMPT,
        user_message=f"Here are my events for the next 7 days:\n{event_summary}",
    )
    return analysis, None


def register() -> None:
    for intent, handler in (
        ("suggest_time", suggest_time),
        ("check_conflicts", check_conflicts),
        ("analyze_schedule", analyze_schedule),
    ):
        register_intent_handler(
            IntentHandlerDef(intent=intent, handle=handler, module_intent=True)
        )
