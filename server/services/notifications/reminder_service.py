"""Reminder service — checks for upcoming events and overdue todos, sends WS notifications."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.task import TaskStatus
from models.event import Event
from models.todo import Todo
from services.calendar.recurrence_service import generate_occurrences
from utils import match_timezone
from ws.manager import ConnectionManager

logger = logging.getLogger(__name__)

# The clients expose lead options up to one day. A bounded catch-up window
# prevents stale reminders after a scheduler outage; exact occurrence keys are
# retained across midnight so a 23:55 delivery is not repeated at 00:05.
MAX_EVENT_REMINDER_LEAD_MINUTES = 1440
MAX_EVENT_REMINDER_LEAD = timedelta(minutes=MAX_EVENT_REMINDER_LEAD_MINUTES)
REMINDER_CATCH_UP = timedelta(minutes=30)
EVENT_START_GRACE = timedelta(minutes=20)
DELIVERY_KEY_RETENTION = timedelta(days=30)

# In-memory dedup uses the same occurrence identity Android persists.
_sent_reminders: dict[str, datetime] = {}


def _delivery_key(
    reminder_type: str,
    occurrence_identity: str,
    scheduled_at: datetime,
) -> str:
    family = "todo" if reminder_type in {"todo", "todo_overdue"} else reminder_type
    return (
        f"delivery:v2:{family}:{occurrence_identity}:"
        f"{int(scheduled_at.timestamp())}"
    )


def _is_due_for_delivery(remind_at: datetime, now: datetime) -> bool:
    return now - REMINDER_CATCH_UP <= remind_at <= now


async def check_event_reminders(
    db: AsyncSession, ws_manager: ConnectionManager, user_id: str
) -> int:
    """Find event reminders whose configured lead time has just elapsed."""
    now = datetime.now(timezone.utc)
    window_start = now - EVENT_START_GRACE
    window_end = now + MAX_EVENT_REMINDER_LEAD

    q = (
        select(Event)
        .where(
            Event.start_time >= window_start,
            Event.start_time <= window_end,
            Event.reminder_minutes != None,  # noqa: E711
        )
    )
    events = (await db.execute(q)).scalars().all()
    sent = 0

    for event in events:
        if event.reminder_minutes not in range(
            0, MAX_EVENT_REMINDER_LEAD_MINUTES + 1
        ):
            continue
        # SQLite returns naive datetimes even for timezone-aware columns, and
        # `now` is aware. Comparing them raises TypeError, which aborted every
        # reminder check -- events, todos, and overdue alike, since this runs
        # first -- so no reminder was ever delivered.
        start_time = match_timezone(event.start_time, now)
        remind_at = start_time - timedelta(minutes=event.reminder_minutes)
        if not _is_due_for_delivery(remind_at, now):
            continue

        key = _delivery_key("event", event.id, start_time)
        if key in _sent_reminders:
            continue

        minutes_until = max(0, int((start_time - now).total_seconds() / 60))
        await ws_manager.send_json(user_id, {
            "type": "reminder",
            "data": {
                "reminder_type": "event",
                "item_id": event.id,
                "title": event.title,
                "message": f"'{event.title}' starts in {minutes_until} minute(s).",
                "minutes_until": minutes_until,
                "delivery_key": key,
            },
        })
        _sent_reminders[key] = now
        sent += 1

    # Check recurring event occurrences within the reminder window
    recurring_q = (
        select(Event)
        .where(
            Event.recurrence_rule != None,  # noqa: E711
            Event.reminder_minutes != None,  # noqa: E711
        )
    )
    recurring_events = (await db.execute(recurring_q)).scalars().all()

    for event in recurring_events:
        if event.reminder_minutes not in range(
            0, MAX_EVENT_REMINDER_LEAD_MINUTES + 1
        ):
            continue
        occurrences = generate_occurrences(event, window_start, window_end)
        for occ in occurrences:
            occ_start = occ["start_time"]
            if isinstance(occ_start, str):
                occ_start = datetime.fromisoformat(occ_start)
            # Occurrences inherit the series' awareness, which came from the
            # database and is therefore naive.
            occ_start = match_timezone(occ_start, now)

            remind_at = occ_start - timedelta(minutes=event.reminder_minutes)
            if not _is_due_for_delivery(remind_at, now):
                continue

            occ_dedup_key = occ["occurrence_date"]
            occurrence_identity = f"{event.id}@{occ_dedup_key}"
            key = _delivery_key("event", occurrence_identity, occ_start)
            if key in _sent_reminders:
                continue

            minutes_until = max(0, int((occ_start - now).total_seconds() / 60))
            await ws_manager.send_json(user_id, {
                "type": "reminder",
                "data": {
                    "reminder_type": "event",
                    "item_id": event.id,
                    "title": event.title,
                    "message": f"'{event.title}' starts in {minutes_until} minute(s).",
                    "minutes_until": minutes_until,
                    "occurrence_date": occ_dedup_key,
                    "delivery_key": key,
                },
            })
            _sent_reminders[key] = now
            sent += 1

    return sent


async def check_todo_reminders(
    db: AsyncSession, ws_manager: ConnectionManager, user_id: str
) -> int:
    """Find non-completed todos due within 60 min. Returns count sent."""
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(minutes=60)

    q = (
        select(Todo)
        .where(
            Todo.due_date >= now,
            Todo.due_date <= window_end,
            Todo.status.notin_([TaskStatus.COMPLETED, TaskStatus.CANCELLED]),
        )
    )
    todos = (await db.execute(q)).scalars().all()
    sent = 0

    for todo in todos:
        due_date = match_timezone(todo.due_date, now)
        key = _delivery_key("todo", todo.id, due_date)
        if key in _sent_reminders:
            continue

        minutes_until = max(0, int((due_date - now).total_seconds() / 60))
        await ws_manager.send_json(user_id, {
            "type": "reminder",
            "data": {
                "reminder_type": "todo",
                "item_id": todo.id,
                "title": todo.title,
                "message": f"'{todo.title}' is due in {minutes_until} minute(s).",
                "minutes_until": minutes_until,
                "delivery_key": key,
            },
        })
        _sent_reminders[key] = now
        sent += 1

    return sent


async def check_overdue_todos(
    db: AsyncSession, ws_manager: ConnectionManager, user_id: str
) -> int:
    """Find overdue pending/in-progress todos, one-time notification each. Returns count sent."""
    now = datetime.now(timezone.utc)

    q = (
        select(Todo)
        .where(
            Todo.due_date < now,
            Todo.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
        )
    )
    todos = (await db.execute(q)).scalars().all()
    sent = 0

    for todo in todos:
        due_date = match_timezone(todo.due_date, now)
        key = _delivery_key("todo_overdue", todo.id, due_date)
        if key in _sent_reminders:
            continue

        await ws_manager.send_json(user_id, {
            "type": "reminder",
            "data": {
                "reminder_type": "todo_overdue",
                "item_id": todo.id,
                "title": todo.title,
                "message": f"'{todo.title}' is overdue.",
                "minutes_until": 0,
                "delivery_key": key,
            },
        })
        _sent_reminders[key] = now
        sent += 1

    return sent


async def run_all_checks(
    db: AsyncSession,
    ws_manager: ConnectionManager,
    user_id: str,
    push_service=None,
) -> int:
    total = 0
    total += await check_event_reminders(db, ws_manager, user_id)
    total += await check_todo_reminders(db, ws_manager, user_id)
    total += await check_overdue_todos(db, ws_manager, user_id)

    # Also send via push notifications if service is available and reminders were sent
    if total > 0 and push_service and push_service.enabled:
        await push_service.send_to_all_devices(
            db,
            title="ClawChat Reminder",
            body=f"You have {total} upcoming reminder{'s' if total != 1 else ''}",
            data={"type": "reminder"},
        )

    return total


def prune_sent_reminders(now: datetime | None = None) -> None:
    """Discard old exact occurrences while retaining claims across midnight."""
    cutoff = (now or datetime.now(timezone.utc)) - DELIVERY_KEY_RETENTION
    expired = [key for key, sent_at in _sent_reminders.items() if sent_at < cutoff]
    for key in expired:
        _sent_reminders.pop(key, None)


def clear_sent_reminders() -> None:
    """Force-reset dedup state for tests and administrative recovery."""
    _sent_reminders.clear()
