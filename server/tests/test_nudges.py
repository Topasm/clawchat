"""Proactive nudge candidate selection.

Rows are loaded through a fresh session so the naive datetimes SQLite returns
are actually exercised; reading objects still cached in the writing session
hides this whole class of defect.
"""

from datetime import datetime, timedelta, timezone


from domain.task import TaskStatus
from models.todo import Todo
from services.notifications import nudge_service
from utils import make_id

UTC = timezone.utc


def _todo(**overrides) -> Todo:
    defaults = dict(
        id=make_id("todo_"),
        title="Something",
        status=TaskStatus.PENDING,
        priority="medium",
        inbox_state="none",
    )
    defaults.update(overrides)
    return Todo(**defaults)


async def _candidates(db_session, session_factory, *todos):
    for todo in todos:
        db_session.add(todo)
    await db_session.commit()
    async with session_factory() as scheduler_db:
        return await nudge_service.find_nudge_candidates(scheduler_db)


async def test_no_todos_produces_no_candidates(db_session, session_factory):
    assert await _candidates(db_session, session_factory) == []


async def test_a_stale_task_is_nudged(db_session, session_factory):
    stale = _todo(title="Forgotten", updated_at=datetime.now(UTC) - timedelta(days=5))

    candidates = await _candidates(db_session, session_factory, stale)

    assert len(candidates) == 1
    assert candidates[0]["todo_id"] == stale.id
    assert "5 days" in candidates[0]["reason"]


async def test_a_task_due_soon_is_nudged(db_session, session_factory):
    due_soon = _todo(title="Due soon", due_date=datetime.now(UTC) + timedelta(hours=5))

    candidates = await _candidates(db_session, session_factory, due_soon)

    assert len(candidates) == 1
    assert candidates[0]["suggested_action"] == "start_now"
    assert "4 hour" in candidates[0]["reason"] or "5 hour" in candidates[0]["reason"]


async def test_a_lingering_inbox_item_is_nudged(db_session, session_factory):
    lingering = _todo(
        title="Unfiled",
        inbox_state="captured",
        created_at=datetime.now(UTC) - timedelta(days=4),
        updated_at=datetime.now(UTC),
    )

    candidates = await _candidates(db_session, session_factory, lingering)

    assert [c["suggested_action"] for c in candidates] == ["organize"]
    assert "4 days" in candidates[0]["reason"]


async def test_a_stale_task_does_not_suppress_the_other_scans(
    db_session, session_factory
):
    """The stale branch runs first. When it raised on the naive/aware
    subtraction it aborted the whole scan, so no nudge was ever produced."""
    stale = _todo(title="Forgotten", updated_at=datetime.now(UTC) - timedelta(days=5))
    due_soon = _todo(title="Due soon", due_date=datetime.now(UTC) + timedelta(hours=5))
    lingering = _todo(
        title="Unfiled",
        inbox_state="captured",
        created_at=datetime.now(UTC) - timedelta(days=4),
        updated_at=datetime.now(UTC),
    )

    candidates = await _candidates(db_session, session_factory, stale, due_soon, lingering)

    assert {c["title"] for c in candidates} == {"Forgotten", "Due soon", "Unfiled"}


async def test_candidates_are_ordered_by_urgency(db_session, session_factory):
    stale = _todo(title="Forgotten", updated_at=datetime.now(UTC) - timedelta(days=5))
    due_soon = _todo(title="Due soon", due_date=datetime.now(UTC) + timedelta(hours=5))

    candidates = await _candidates(db_session, session_factory, stale, due_soon)

    urgencies = [c["urgency"] for c in candidates]
    assert urgencies == sorted(urgencies, reverse=True)


async def test_completed_tasks_are_never_nudged(db_session, session_factory):
    done = _todo(
        title="Done",
        status=TaskStatus.COMPLETED,
        updated_at=datetime.now(UTC) - timedelta(days=10),
        due_date=datetime.now(UTC) + timedelta(hours=5),
    )

    assert await _candidates(db_session, session_factory, done) == []


async def test_a_task_due_beyond_the_window_is_not_nudged(db_session, session_factory):
    later = _todo(title="Next week", due_date=datetime.now(UTC) + timedelta(days=7))

    assert await _candidates(db_session, session_factory, later) == []
