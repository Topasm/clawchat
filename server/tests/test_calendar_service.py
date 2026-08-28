"""Calendar events, including recurring-series expansion and deletion."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from exceptions import NotFoundError
from services import calendar_service
from utils import make_id

UTC = timezone.utc


async def _event(db, **overrides):
    defaults = dict(
        title="Standup",
        start_time=datetime(2026, 8, 28, 9, 0, tzinfo=UTC),
        end_time=datetime(2026, 8, 28, 9, 30, tzinfo=UTC),
    )
    defaults.update(overrides)
    event = await calendar_service.create_event(db, **defaults)
    await db.commit()
    return event


async def _all_day(db, **overrides):
    return await _event(
        db,
        title="Company holiday",
        is_all_day=True,
        start_time=datetime(2026, 8, 28, 0, 0, tzinfo=UTC),
        end_time=None,
        **overrides,
    )


def _dates(rows):
    return [r["occurrence_date"] for r in rows if isinstance(r, dict)]


# --- basics ---------------------------------------------------------------


async def test_created_event_is_retrievable(db_session):
    event = await _event(db_session)

    assert (await calendar_service.get_event(db_session, event.id)).title == "Standup"


async def test_missing_event_raises(db_session):
    with pytest.raises(NotFoundError):
        await calendar_service.get_event(db_session, "evt_missing")


async def test_creating_against_an_unknown_project_raises(db_session):
    with pytest.raises(NotFoundError):
        await _event(db_session, project_id="proj_missing")


async def test_deleting_removes_the_event(db_session):
    event = await _event(db_session)

    await calendar_service.delete_event(db_session, event.id)

    with pytest.raises(NotFoundError):
        await calendar_service.get_event(db_session, event.id)


# --- occurrence deletion --------------------------------------------------


async def test_this_only_records_an_exception(db_session):
    event = await _event(db_session, recurrence_rule="FREQ=DAILY")

    await calendar_service.delete_event_occurrence(
        db_session, event.id, "2026-08-30", "this_only"
    )

    assert json.loads(event.recurrence_exceptions) == ["2026-08-30"]


async def test_this_only_is_idempotent(db_session):
    event = await _event(db_session, recurrence_rule="FREQ=DAILY")

    for _ in range(2):
        await calendar_service.delete_event_occurrence(
            db_session, event.id, "2026-08-30", "this_only"
        )

    assert json.loads(event.recurrence_exceptions) == ["2026-08-30"]


async def test_all_deletes_the_series(db_session):
    event = await _event(db_session, recurrence_rule="FREQ=DAILY")

    await calendar_service.delete_event_occurrence(db_session, event.id, "2026-08-30", "all")

    with pytest.raises(NotFoundError):
        await calendar_service.get_event(db_session, event.id)


async def test_this_and_future_removes_the_selected_occurrence(db_session):
    event = await _event(db_session, recurrence_rule="FREQ=DAILY")

    await calendar_service.delete_event_occurrence(
        db_session, event.id, "2026-08-30", "this_and_future"
    )
    rows, _ = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 9, 5, tzinfo=UTC),
    )

    assert "2026-08-30" not in _dates(rows)
    assert "2026-08-29" in _dates(rows)


async def test_this_and_future_removes_the_selected_all_day_occurrence(db_session):
    """The series runs at midnight, so the occurrence sits exactly on the
    recurrence end. Expansion is inclusive, so it used to survive the delete."""
    event = await _all_day(db_session, recurrence_rule="FREQ=DAILY")

    await calendar_service.delete_event_occurrence(
        db_session, event.id, "2026-08-30", "this_and_future"
    )
    rows, _ = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 9, 5, tzinfo=UTC),
    )

    assert "2026-08-30" not in _dates(rows)
    assert "2026-08-29" in _dates(rows)


# --- listing --------------------------------------------------------------


async def test_recurring_events_expand_within_the_range(db_session):
    await _event(db_session, recurrence_rule="FREQ=DAILY")

    rows, _ = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 8, 31, tzinfo=UTC),
    )

    assert _dates(rows) == ["2026-08-29", "2026-08-30"]


async def test_exceptions_are_omitted_from_expansion(db_session):
    event = await _event(db_session, recurrence_rule="FREQ=DAILY")
    await calendar_service.delete_event_occurrence(
        db_session, event.id, "2026-08-29", "this_only"
    )

    rows, _ = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 8, 31, tzinfo=UTC),
    )

    assert _dates(rows) == ["2026-08-30"]


async def test_pages_do_not_repeat_the_same_occurrences(db_session):
    """Pagination applied only to stored rows, so every page appended the
    entire expansion again."""
    for index in range(3):
        await _event(
            db_session,
            title=f"One-off {index}",
            start_time=datetime(2026, 8, 28, 10 + index, 0, tzinfo=UTC),
            end_time=None,
        )
    await _event(db_session, title="Daily", recurrence_rule="FREQ=DAILY")

    page_one, total = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 8, 31, tzinfo=UTC),
        page=1,
        limit=2,
    )
    page_two, _ = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 8, 31, tzinfo=UTC),
        page=2,
        limit=2,
    )

    assert len(page_one) == 2
    overlap = set(_dates(page_one)) & set(_dates(page_two))
    assert overlap == set(), f"occurrences repeated across pages: {overlap}"


async def test_total_counts_every_row_the_pages_can_return(db_session):
    await _event(db_session, title="One-off", end_time=None)
    await _event(db_session, title="Daily", recurrence_rule="FREQ=DAILY")

    collected = []
    page = 1
    while True:
        rows, total = await calendar_service.get_events(
            db_session,
            start_after=datetime(2026, 8, 28, tzinfo=UTC),
            start_before=datetime(2026, 8, 31, tzinfo=UTC),
            page=page,
            limit=2,
        )
        collected.extend(rows)
        if not rows or len(collected) >= total:
            break
        page += 1

    assert len(collected) == total


async def test_project_filter_applies_to_expanded_occurrences(db_session):
    from models.project import Project

    project = Project(id=make_id("proj_"), title="Work")
    db_session.add(project)
    await db_session.commit()
    await _event(db_session, title="Personal daily", recurrence_rule="FREQ=DAILY")
    await _event(
        db_session,
        title="Work daily",
        project_id=project.id,
        recurrence_rule="FREQ=DAILY",
    )

    rows, _ = await calendar_service.get_events(
        db_session,
        start_after=datetime(2026, 8, 28, tzinfo=UTC),
        start_before=datetime(2026, 8, 31, tzinfo=UTC),
        project_id=project.id,
    )

    titles = {r["title"] if isinstance(r, dict) else r.title for r in rows}
    assert titles == {"Work daily"}
