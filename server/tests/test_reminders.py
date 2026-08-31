"""Reminder checks run by the scheduler.

Every test loads its rows through a fresh session, the way the scheduler does.
That matters: SQLite returns naive datetimes on a real round trip, and reading
the objects still cached in the writing session hides the whole class of bug
these cover.
"""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from domain.task import TaskStatus
from models.event import Event
from models.todo import Todo
from services.notifications import reminder_service
from utils import make_id


class RecordingWebSocketManager:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, user_id, payload):
        self.sent.append(payload)


@pytest.fixture
def ws():
    return RecordingWebSocketManager()


@pytest.fixture(autouse=True)
def _reset_dedup():
    reminder_service.clear_sent_reminders()
    yield
    reminder_service.clear_sent_reminders()


@pytest_asyncio.fixture
async def fresh(session_factory):
    """Open a session that has to read rows back out of the database."""

    async def _open():
        return session_factory()

    return _open


def _reminder_types(ws):
    return [m["data"]["reminder_type"] for m in ws.sent]


# --- events ---------------------------------------------------------------


async def test_event_reminder_is_delivered(db_session, session_factory, ws):
    start = datetime.now(timezone.utc) + timedelta(minutes=10)
    db_session.add(
        Event(id=make_id("evt_"), title="Standup", start_time=start, reminder_minutes=30)
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 1
    assert _reminder_types(ws) == ["event"]
    assert "Standup" in ws.sent[0]["data"]["message"]
    assert ws.sent[0]["data"]["delivery_key"].startswith("delivery:v2:event:")


async def test_one_day_event_reminder_is_delivered_at_its_lead_time(
    db_session, session_factory, ws
):
    start = datetime.now(timezone.utc) + timedelta(days=1)
    db_session.add(
        Event(
            id=make_id("evt_"),
            title="Tomorrow",
            start_time=start,
            reminder_minutes=1440,
        )
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 1
    assert _reminder_types(ws) == ["event"]


async def test_long_lead_event_waits_until_remind_at(db_session, session_factory, ws):
    start = datetime.now(timezone.utc) + timedelta(minutes=121)
    db_session.add(
        Event(
            id=make_id("evt_"),
            title="Not yet",
            start_time=start,
            reminder_minutes=120,
        )
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 0


async def test_long_lead_event_outside_catch_up_is_not_replayed(
    db_session, session_factory, ws
):
    start = datetime.now(timezone.utc) + timedelta(minutes=30)
    db_session.add(
        Event(
            id=make_id("evt_"),
            title="Already covered",
            start_time=start,
            reminder_minutes=120,
        )
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 0


async def test_a_reminder_is_not_sent_before_its_lead_time(
    db_session, session_factory, ws
):
    start = datetime.now(timezone.utc) + timedelta(minutes=50)
    db_session.add(
        Event(id=make_id("evt_"), title="Later", start_time=start, reminder_minutes=5)
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 0


async def test_the_same_event_is_only_reminded_once(db_session, session_factory, ws):
    start = datetime.now(timezone.utc) + timedelta(minutes=10)
    db_session.add(
        Event(id=make_id("evt_"), title="Standup", start_time=start, reminder_minutes=30)
    )
    await db_session.commit()

    for _ in range(3):
        async with session_factory() as scheduler_db:
            await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert len(ws.sent) == 1


async def test_recurring_occurrences_are_reminded(db_session, session_factory, ws):
    # A series that started in the past and recurs into the reminder window.
    start = datetime.now(timezone.utc) + timedelta(minutes=10) - timedelta(days=2)
    db_session.add(
        Event(
            id=make_id("evt_"),
            title="Daily standup",
            start_time=start,
            reminder_minutes=30,
            recurrence_rule="FREQ=DAILY",
        )
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 1
    assert ws.sent[0]["data"]["occurrence_date"]


# --- todos ----------------------------------------------------------------


async def test_todo_due_soon_is_reminded(db_session, session_factory, ws):
    due = datetime.now(timezone.utc) + timedelta(minutes=20)
    db_session.add(
        Todo(id=make_id("todo_"), title="File taxes", status=TaskStatus.PENDING,
             priority="medium", due_date=due)
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 1
    assert _reminder_types(ws) == ["todo"]
    assert ws.sent[0]["data"]["delivery_key"].startswith("delivery:v2:todo:")


async def test_completed_todos_are_not_reminded(db_session, session_factory, ws):
    due = datetime.now(timezone.utc) + timedelta(minutes=20)
    db_session.add(
        Todo(id=make_id("todo_"), title="Done already", status=TaskStatus.COMPLETED,
             priority="medium", due_date=due)
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        assert await reminder_service.run_all_checks(scheduler_db, ws, "user") == 0


async def test_overdue_todo_is_reported_once(db_session, session_factory, ws):
    overdue = datetime.now(timezone.utc) - timedelta(hours=3)
    db_session.add(
        Todo(id=make_id("todo_"), title="Late thing", status=TaskStatus.PENDING,
             priority="medium", due_date=overdue)
    )
    await db_session.commit()

    for _ in range(2):
        async with session_factory() as scheduler_db:
            await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert _reminder_types(ws) == ["todo_overdue"]


# --- the failure that hid all of the above -------------------------------


async def test_one_event_does_not_suppress_todo_and_overdue_reminders(
    db_session, session_factory, ws
):
    """check_event_reminders runs first. When it raised on the naive/aware
    comparison it took the todo and overdue checks down with it, so a single
    upcoming event silenced every reminder the server had."""
    db_session.add(
        Event(
            id=make_id("evt_"),
            title="Standup",
            start_time=datetime.now(timezone.utc) + timedelta(minutes=10),
            reminder_minutes=30,
        )
    )
    db_session.add(
        Todo(id=make_id("todo_"), title="Due soon", status=TaskStatus.PENDING,
             priority="medium", due_date=datetime.now(timezone.utc) + timedelta(minutes=20))
    )
    db_session.add(
        Todo(id=make_id("todo_"), title="Overdue", status=TaskStatus.PENDING,
             priority="medium", due_date=datetime.now(timezone.utc) - timedelta(hours=1))
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        sent = await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert sent == 3
    assert sorted(_reminder_types(ws)) == ["event", "todo", "todo_overdue"]


async def test_reminder_minutes_are_reported_from_the_stored_time(
    db_session, session_factory, ws
):
    """A naive stored value read as if it were UTC-naive would skew this."""
    start = datetime.now(timezone.utc) + timedelta(minutes=15)
    db_session.add(
        Event(id=make_id("evt_"), title="Soon", start_time=start, reminder_minutes=30)
    )
    await db_session.commit()

    async with session_factory() as scheduler_db:
        await reminder_service.run_all_checks(scheduler_db, ws, "user")

    assert ws.sent[0]["data"]["minutes_until"] in (14, 15)


def test_midnight_prune_retains_recent_occurrence_keys():
    sent_at = datetime(2026, 8, 31, 23, 55, tzinfo=timezone.utc)
    after_midnight = datetime(2026, 9, 1, 0, 5, tzinfo=timezone.utc)
    key = "delivery:v2:event:event-1:1788220500"
    reminder_service._sent_reminders[key] = sent_at

    reminder_service.prune_sent_reminders(after_midnight)
    assert key in reminder_service._sent_reminders

    reminder_service.prune_sent_reminders(sent_at + timedelta(days=31))
    assert key not in reminder_service._sent_reminders


def test_delivery_key_unifies_upcoming_and_overdue_todo_occurrence():
    due = datetime(2026, 9, 1, 1, 2, 3, 999999, tzinfo=timezone.utc)

    upcoming = reminder_service._delivery_key("todo", "todo-1", due)
    overdue = reminder_service._delivery_key("todo_overdue", "todo-1", due)

    assert upcoming == overdue
    assert upcoming == "delivery:v2:todo:todo-1:1788224523"
