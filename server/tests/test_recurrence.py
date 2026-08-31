"""Recurring task and event expansion."""

from datetime import datetime, timedelta, timezone


from domain.task import TaskStatus
from models.todo import Todo
from services.calendar.recurrence_service import generate_occurrences, parse_rrule
from services.tasks.todo_recurrence_service import compute_next_occurrence, spawn_next_occurrence
from utils import make_id


# --- compute_next_occurrence --------------------------------------------


def test_next_daily_occurrence():
    start = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)
    assert compute_next_occurrence("FREQ=DAILY", start, start) == start + timedelta(days=1)


def test_series_ends_at_recurrence_end():
    start = datetime(2026, 8, 28, tzinfo=timezone.utc)
    end = datetime(2026, 8, 28, 23, 59, tzinfo=timezone.utc)
    assert compute_next_occurrence("FREQ=DAILY", start, start, recurrence_end=end) is None


def test_naive_recurrence_end_is_comparable_to_an_aware_reference():
    """SQLite returns naive datetimes, callers may hold aware ones.

    Comparing the two directly raises TypeError, which used to escape
    uncaught and abort completing the task.
    """
    aware = datetime(2026, 8, 28, tzinfo=timezone.utc)
    naive_end = datetime(2027, 1, 1)

    result = compute_next_occurrence("FREQ=DAILY", aware, aware, recurrence_end=naive_end)

    assert result is not None


def test_naive_reference_with_aware_end_is_also_comparable():
    naive = datetime(2026, 8, 28)
    aware_end = datetime(2027, 1, 1, tzinfo=timezone.utc)

    result = compute_next_occurrence("FREQ=DAILY", naive, naive, recurrence_end=aware_end)

    assert result is not None


def test_exception_dates_are_skipped():
    start = datetime(2026, 8, 28, tzinfo=timezone.utc)
    # 8/29 is excluded, so the next occurrence is 8/30.
    result = compute_next_occurrence(
        "FREQ=DAILY", start, start, exceptions_json='["2026-08-29"]'
    )
    assert result == datetime(2026, 8, 30, tzinfo=timezone.utc)


def test_invalid_rule_returns_none_instead_of_raising():
    start = datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert compute_next_occurrence("NOT-AN-RRULE", start, start) is None


def test_weekday_rule_lands_on_the_next_listed_day():
    friday = datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert friday.weekday() == 4

    result = compute_next_occurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR", friday, friday)

    assert result == datetime(2026, 8, 31, tzinfo=timezone.utc)  # Monday


# --- spawn_next_occurrence ----------------------------------------------


async def _recurring_todo(db, **overrides) -> Todo:
    todo = Todo(
        id=make_id("todo_"),
        title="Water the plants",
        status=TaskStatus.COMPLETED,
        priority="medium",
        due_date=datetime(2026, 8, 28, tzinfo=timezone.utc),
        recurrence_rule="FREQ=DAILY",
        **overrides,
    )
    db.add(todo)
    await db.flush()
    return todo


async def test_completing_a_recurring_todo_spawns_the_next(db_session):
    todo = await _recurring_todo(db_session)

    nxt = await spawn_next_occurrence(db_session, todo)

    assert nxt is not None
    assert nxt.title == todo.title
    assert nxt.status == TaskStatus.PENDING
    assert nxt.due_date.date() == datetime(2026, 8, 29).date()
    # The whole series points back at the task that started it.
    assert nxt.recurring_source_id == todo.id


async def test_series_id_is_preserved_across_generations(db_session):
    first = await _recurring_todo(db_session)
    second = await spawn_next_occurrence(db_session, first)
    second.status = TaskStatus.COMPLETED
    third = await spawn_next_occurrence(db_session, second)

    assert third.recurring_source_id == first.id


async def test_finished_series_spawns_nothing(db_session):
    todo = await _recurring_todo(
        db_session, recurrence_end=datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)
    )

    assert await spawn_next_occurrence(db_session, todo) is None


async def test_non_recurring_todo_spawns_nothing(db_session):
    todo = Todo(
        id=make_id("todo_"),
        title="One off",
        status=TaskStatus.COMPLETED,
        priority="medium",
    )
    db_session.add(todo)
    await db_session.flush()

    assert await spawn_next_occurrence(db_session, todo) is None


# --- event expansion -----------------------------------------------------


class FakeEvent:
    def __init__(self, **kwargs):
        self.id = "evt_1"
        self.project_id = None
        self.title = "Standup"
        self.description = None
        self.location = None
        self.is_all_day = False
        self.reminder_minutes = None
        self.recurrence_rule = "FREQ=DAILY"
        self.recurrence_end = None
        self.recurrence_exceptions = None
        self.start_time = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)
        self.end_time = datetime(2026, 8, 28, 9, 30, tzinfo=timezone.utc)
        self.tags = None
        self.created_at = self.start_time
        self.updated_at = self.start_time
        self.__dict__.update(kwargs)


def test_occurrences_exclude_the_base_event():
    event = FakeEvent()

    occurrences = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 8, 31, 23, 59, tzinfo=timezone.utc),
    )

    dates = [o["occurrence_date"] for o in occurrences]
    assert dates == ["2026-08-29", "2026-08-30", "2026-08-31"]


def test_occurrences_keep_the_series_duration():
    event = FakeEvent()

    occurrence = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 8, 29, 23, 59, tzinfo=timezone.utc),
    )[0]

    assert occurrence["end_time"] - occurrence["start_time"] == timedelta(minutes=30)


def test_occurrences_stop_at_recurrence_end():
    event = FakeEvent(recurrence_end=datetime(2026, 8, 30, 23, 59, tzinfo=timezone.utc))

    occurrences = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 9, 30, tzinfo=timezone.utc),
    )

    assert [o["occurrence_date"] for o in occurrences] == ["2026-08-29", "2026-08-30"]


def test_a_naive_range_still_expands_against_an_aware_series():
    """The API layer can hand in naive bounds read back from SQLite."""
    event = FakeEvent()

    occurrences = generate_occurrences(
        event, datetime(2026, 8, 28), datetime(2026, 8, 30, 23, 59)
    )

    assert [o["occurrence_date"] for o in occurrences] == ["2026-08-29", "2026-08-30"]


def test_exception_dates_are_omitted_from_expansion():
    event = FakeEvent(recurrence_exceptions='["2026-08-29"]')

    occurrences = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 8, 30, 23, 59, tzinfo=timezone.utc),
    )

    assert [o["occurrence_date"] for o in occurrences] == ["2026-08-30"]


def test_malformed_rule_expands_to_nothing():
    assert (
        parse_rrule(
            "NOPE",
            datetime(2026, 8, 28, tzinfo=timezone.utc),
            datetime(2026, 8, 28, tzinfo=timezone.utc),
            datetime(2026, 8, 30, tzinfo=timezone.utc),
        )
        == []
    )
