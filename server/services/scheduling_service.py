"""Smart scheduling service — conflict detection, free slot finder, AI suggestions."""

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.event import Event
from services.ai_service import AIService
from services.recurrence_service import generate_occurrences
from utils import match_timezone, strip_markdown_fences

logger = logging.getLogger(__name__)

# Default working hours
DEFAULT_WORK_START = 9  # 9 AM
DEFAULT_WORK_END = 17  # 5 PM


def _busy_entry(
    event: Event,
    start_time: datetime,
    end_time: datetime | None,
    *,
    is_occurrence: bool = False,
    occurrence_date: str | None = None,
) -> dict:
    return {
        "id": event.id,
        "title": event.title,
        "start_time": start_time,
        "end_time": end_time or (start_time + timedelta(minutes=30)),
        "is_occurrence": is_occurrence,
        "occurrence_date": occurrence_date,
    }


async def _collect_busy_entries(
    db: AsyncSession,
    range_start: datetime,
    range_end: datetime,
) -> list[dict]:
    """Load concrete event intervals that overlap a range."""
    regular_q = select(Event).where(
        Event.recurrence_rule.is_(None),
        Event.start_time < range_end,
    )
    regular_events = (await db.execute(regular_q)).scalars().all()

    entries = []
    for event in regular_events:
        event_start = match_timezone(event.start_time, range_start)
        event_end = match_timezone(event.end_time, range_start) if event.end_time else None
        effective_end = event_end or (event_start + timedelta(minutes=30))
        if effective_end > range_start:
            entries.append(_busy_entry(event, event_start, event_end))

    recurring_q = select(Event).where(
        Event.recurrence_rule.is_not(None),
        Event.start_time < range_end,
        or_(Event.recurrence_end.is_(None), Event.recurrence_end >= range_start),
    )
    recurring_events = (await db.execute(recurring_q)).scalars().all()
    for event in recurring_events:
        event_start = match_timezone(event.start_time, range_start)
        event_end = match_timezone(event.end_time, range_start) if event.end_time else None
        base_end = event_end or (event_start + timedelta(minutes=30))
        if event_start < range_end and base_end > range_start:
            entries.append(_busy_entry(event, event_start, event_end))

        duration = base_end - event_start
        occurrences = generate_occurrences(
            event,
            range_start - duration,
            range_end,
        )
        for occurrence in occurrences:
            occurrence_start = match_timezone(occurrence["start_time"], range_start)
            occurrence_end = (
                match_timezone(occurrence["end_time"], range_start)
                if occurrence["end_time"]
                else None
            ) or (
                occurrence_start + timedelta(minutes=30)
            )
            if occurrence_start < range_end and occurrence_end > range_start:
                entries.append(
                    _busy_entry(
                        event,
                        occurrence_start,
                        occurrence_end,
                        is_occurrence=True,
                        occurrence_date=occurrence.get("occurrence_date"),
                    )
                )

    entries.sort(key=lambda entry: entry["start_time"])
    return entries


def _merge_intervals(
    intervals: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    """Merge sorted or unsorted overlapping busy intervals."""
    if not intervals:
        return []

    sorted_intervals = sorted(intervals, key=lambda interval: interval[0])
    merged = [sorted_intervals[0]]
    for start_time, end_time in sorted_intervals[1:]:
        previous_start, previous_end = merged[-1]
        if start_time <= previous_end:
            merged[-1] = (previous_start, max(previous_end, end_time))
        else:
            merged.append((start_time, end_time))
    return merged


async def find_conflicts(
    db: AsyncSession, start_time: datetime, end_time: datetime
) -> list[dict]:
    """Find events that overlap with the given time range, including recurring occurrences."""
    entries = await _collect_busy_entries(db, start_time, end_time)
    return [
        {
            "id": entry["id"],
            "title": entry["title"],
            "start_time": entry["start_time"].isoformat(),
            "end_time": entry["end_time"].isoformat(),
            **(
                {
                    "is_occurrence": True,
                    "occurrence_date": entry["occurrence_date"],
                }
                if entry["is_occurrence"]
                else {}
            ),
        }
        for entry in entries
    ]


async def find_free_slots(
    db: AsyncSession,
    range_start: datetime,
    range_end: datetime,
    duration_minutes: int = 60,
    working_hours: tuple[int, int] = (DEFAULT_WORK_START, DEFAULT_WORK_END),
) -> list[dict]:
    """Find free time slots of at least `duration_minutes` within working hours."""
    entries = await _collect_busy_entries(db, range_start, range_end)
    busy = _merge_intervals(
        [(entry["start_time"], entry["end_time"]) for entry in entries]
    )

    # Walk through each day in the range during working hours
    free_slots: list[dict] = []
    work_start_h, work_end_h = working_hours
    duration = timedelta(minutes=duration_minutes)

    current_day = range_start.date()
    end_day = range_end.date()

    busy_index = 0
    while current_day <= end_day:
        day_start = datetime(current_day.year, current_day.month, current_day.day, work_start_h, 0, tzinfo=timezone.utc)
        day_end = datetime(current_day.year, current_day.month, current_day.day, work_end_h, 0, tzinfo=timezone.utc)

        # Skip weekends
        if current_day.weekday() >= 5:
            current_day += timedelta(days=1)
            continue

        day_start = max(day_start, range_start)
        day_end = min(day_end, range_end)
        if day_start >= day_end:
            current_day += timedelta(days=1)
            continue

        while busy_index < len(busy) and busy[busy_index][1] <= day_start:
            busy_index += 1

        # Find gaps
        cursor = day_start
        day_busy_index = busy_index
        while day_busy_index < len(busy) and busy[day_busy_index][0] < day_end:
            b_start, b_end = busy[day_busy_index]
            b_start = max(b_start, day_start)
            b_end = min(b_end, day_end)
            if b_start - cursor >= duration:
                free_slots.append({
                    "start": cursor.isoformat(),
                    "end": b_start.isoformat(),
                    "duration_minutes": int((b_start - cursor).total_seconds() / 60),
                })
            cursor = max(cursor, b_end)
            day_busy_index += 1

        # Check remaining time after last busy block
        if day_end - cursor >= duration:
            free_slots.append({
                "start": cursor.isoformat(),
                "end": day_end.isoformat(),
                "duration_minutes": int((day_end - cursor).total_seconds() / 60),
            })

        current_day += timedelta(days=1)

    return free_slots


async def suggest_best_time(
    db: AsyncSession,
    ai_service: AIService,
    title: str,
    duration_minutes: int = 60,
    preferred_date: datetime | None = None,
    constraints: str | None = None,
) -> list[dict]:
    """Find free slots and use AI to rank the top 3 with reasoning."""
    # Default range: next 5 working days
    now = datetime.now(timezone.utc)
    range_start = preferred_date or now
    range_end = range_start + timedelta(days=7)

    free_slots = await find_free_slots(db, range_start, range_end, duration_minutes)

    if not free_slots:
        return []

    # Limit to first 10 slots for AI context
    slot_text = "\n".join(
        f"- Slot {i+1}: {s['start']} to {s['end']} ({s['duration_minutes']} min available)"
        for i, s in enumerate(free_slots[:10])
    )

    prompt = f"""I need to schedule "{title}" ({duration_minutes} minutes).
Here are my available time slots:

{slot_text}

{f"Additional constraints: {constraints}" if constraints else ""}

Pick the best 3 time slots and explain why each is good. Return your answer as a JSON array:
[{{"start": "ISO datetime", "end": "ISO datetime", "reason": "brief explanation"}}]

Return ONLY the JSON array, no other text."""

    try:
        response = await ai_service.generate_completion(
            system_prompt="You are a scheduling assistant. Analyze calendar availability and suggest optimal meeting times. Always return valid JSON.",
            user_message=prompt,
        )

        # Parse the JSON from AI response
        cleaned = strip_markdown_fences(response)

        suggestions = json.loads(cleaned)
        return suggestions[:3] if isinstance(suggestions, list) else []
    except Exception:
        logger.exception("AI scheduling suggestion failed")
        # Fallback: return first 3 free slots with generic reasoning
        return [
            {
                "start": s["start"],
                "end": (datetime.fromisoformat(s["start"]) + timedelta(minutes=duration_minutes)).isoformat(),
                "reason": "Available time slot",
            }
            for s in free_slots[:3]
        ]
