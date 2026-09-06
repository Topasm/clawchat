"""Task completion is one-off, including records made by older versions."""

from datetime import datetime, timezone

import pytest

from domain.task import TaskStatus
from models.todo import Todo
from utils import make_id


@pytest.mark.parametrize("bulk", [False, True])
async def test_legacy_completion_does_not_spawn_or_delete_tasks(client, auth_headers, db_session, bulk):
    task = Todo(
        id=make_id("todo_"), title="Legacy daily task", status=TaskStatus.PENDING,
        priority="medium", due_date=datetime(2026, 8, 28, tzinfo=timezone.utc),
        recurrence_rule="FREQ=DAILY",
    )
    db_session.add(task)
    await db_session.commit()
    for _ in range(2):
        response = await client.patch(
            "/api/todos/bulk" if bulk else f"/api/todos/{task.id}",
            json={"status": "completed", **({"ids": [task.id]} if bulk else {})},
            headers=auth_headers,
        )
        assert response.status_code == 200
    response = await client.get("/api/todos", headers=auth_headers)
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == task.id
    assert items[0]["status"] == "completed"
    assert items[0]["is_recurring"] is False
    assert items[0]["recurrence_rule"] is None
    await db_session.refresh(task)
    assert task.recurrence_rule == "FREQ=DAILY"  # Preserve historical data.


async def test_legacy_create_and_update_cannot_enable_recurrence(client, auth_headers, db_session):
    response = await client.post("/api/todos", headers=auth_headers, json={
        "title": "One-off task", "recurrence_rule": "FREQ=DAILY",
        "recurrence_end": "2027-01-01T00:00:00Z",
    })
    assert response.status_code == 201
    task_id = response.json()["id"]
    response = await client.patch(f"/api/todos/{task_id}", headers=auth_headers, json={
        "recurrence_rule": "FREQ=WEEKLY", "description": "Still editable",
    })
    assert response.status_code == 200
    assert response.json()["description"] == "Still editable"
    assert response.json()["is_recurring"] is False
    task = await db_session.get(Todo, task_id)
    assert task.recurrence_rule is None
    assert task.recurrence_end is None
