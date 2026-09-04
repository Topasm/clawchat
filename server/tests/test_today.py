"""Today bucketing and Inbox summary contract coverage."""

from datetime import datetime, timezone

import pytest

from domain.task import TaskStatus
from models.todo import Todo


@pytest.mark.asyncio
async def test_today_uses_the_client_local_day_and_half_open_boundaries(
    client,
    auth_headers,
    db_session,
):
    in_today = Todo(
        title="KST today",
        due_date=datetime(2026, 8, 31, 16, tzinfo=timezone.utc),
    )
    before_today = Todo(
        title="KST overdue",
        due_date=datetime(2026, 8, 31, 14, 59, 59, tzinfo=timezone.utc),
    )
    at_tomorrow = Todo(
        title="KST tomorrow",
        due_date=datetime(2026, 9, 1, 15, tzinfo=timezone.utc),
    )
    db_session.add_all([in_today, before_today, at_tomorrow])
    await db_session.commit()

    response = await client.get(
        "/api/today",
        params={"date": "2026-09-01", "utc_offset_minutes": 540},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["date"] == "2026-09-01"
    assert [todo["id"] for todo in body["today_tasks"]] == [in_today.id]
    assert [todo["id"] for todo in body["overdue_tasks"]] == [before_today.id]
    assert at_tomorrow.id not in {
        todo["id"] for todo in body["today_tasks"] + body["overdue_tasks"]
    }


@pytest.mark.asyncio
async def test_today_inbox_count_tracks_open_inbox_workflow_items_only(
    client,
    auth_headers,
    db_session,
):
    db_session.add_all(
        [
            Todo(title="Regular undated task", inbox_state="none"),
            Todo(title="Captured", inbox_state="captured"),
            Todo(
                title="Finished capture",
                inbox_state="captured",
                status=TaskStatus.COMPLETED,
            ),
            Todo(
                title="Cancelled capture",
                inbox_state="error",
                status=TaskStatus.CANCELLED,
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        "/api/today",
        params={"date": "2026-09-01", "utc_offset_minutes": 540},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["inbox_count"] == 1
    assert [todo["title"] for todo in body["needs_review"]] == ["Captured"]


@pytest.mark.asyncio
async def test_today_surfaces_pending_tasks_with_no_due_date(
    client,
    auth_headers,
    db_session,
):
    # Otherwise this task is neither "today" nor "overdue" and simply
    # vanishes from the daily view.
    undated = Todo(title="Undated pending task", inbox_state="none")
    dated = Todo(
        title="Dated task",
        due_date=datetime(2026, 9, 1, 3, tzinfo=timezone.utc),
        inbox_state="none",
    )
    undated_but_in_inbox = Todo(title="Still triaging", inbox_state="captured")
    undated_but_completed = Todo(
        title="Already done",
        status=TaskStatus.COMPLETED,
        inbox_state="none",
    )
    db_session.add_all([undated, dated, undated_but_in_inbox, undated_but_completed])
    await db_session.commit()

    response = await client.get(
        "/api/today",
        params={"date": "2026-09-01", "utc_offset_minutes": 540},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert [todo["id"] for todo in body["needs_date_tasks"]] == [undated.id]


@pytest.mark.asyncio
async def test_today_keeps_inbox_workflow_items_out_of_schedule_buckets(
    client,
    auth_headers,
    db_session,
):
    scheduled = Todo(
        title="Organised today task",
        due_date=datetime(2026, 9, 1, 3, tzinfo=timezone.utc),
        inbox_state="none",
    )
    captured = Todo(
        title="Captured with parsed date",
        due_date=datetime(2026, 9, 1, 4, tzinfo=timezone.utc),
        inbox_state="captured",
    )
    processing = Todo(
        title="Processing in progress",
        status=TaskStatus.IN_PROGRESS,
        inbox_state="planning",
    )
    db_session.add_all([scheduled, captured, processing])
    await db_session.commit()

    response = await client.get(
        "/api/today",
        params={"date": "2026-09-01", "utc_offset_minutes": 540},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert [todo["title"] for todo in body["today_tasks"]] == ["Organised today task"]
    assert captured.id not in {todo["id"] for todo in body["overdue_tasks"]}
    assert processing.id not in {todo["id"] for todo in body["today_tasks"]}
