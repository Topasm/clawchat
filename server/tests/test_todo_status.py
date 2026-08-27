"""Contract and persistence tests for the canonical task lifecycle."""

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from domain.task import TASK_STATUS_CHECK_SQL, TaskStatus
from main import app
from models.todo import Todo
from utils.inbox_display import get_next_action


@pytest.mark.parametrize("status", list(TaskStatus))
@pytest.mark.asyncio
async def test_create_accepts_and_persists_every_task_status(
    client,
    auth_headers,
    status: TaskStatus,
):
    create_response = await client.post(
        "/api/todos",
        json={"title": f"Task in {status.value}", "status": status.value},
        headers=auth_headers,
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["status"] == status.value
    assert (created["completed_at"] is not None) is (
        status is TaskStatus.COMPLETED
    )

    get_response = await client.get(
        f"/api/todos/{created['id']}",
        headers=auth_headers,
    )
    assert get_response.status_code == 200
    assert get_response.json()["status"] == status.value


@pytest.mark.asyncio
async def test_in_progress_survives_update_and_fresh_api_reads(client, auth_headers):
    create_response = await client.post(
        "/api/todos",
        json={"title": "Persist progress"},
        headers=auth_headers,
    )
    todo_id = create_response.json()["id"]

    update_response = await client.patch(
        f"/api/todos/{todo_id}",
        json={"status": TaskStatus.IN_PROGRESS.value},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == TaskStatus.IN_PROGRESS.value

    list_response = await client.get(
        "/api/todos",
        params={"status": TaskStatus.IN_PROGRESS.value},
        headers=auth_headers,
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [todo_id]
    assert list_response.json()["items"][0]["status"] == TaskStatus.IN_PROGRESS.value


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("post", "/api/todos", {"title": "Invalid", "status": "blocked"}),
        ("patch", "/api/todos/missing", {"status": "blocked"}),
        ("patch", "/api/todos/bulk", {"ids": ["missing"], "status": "blocked"}),
    ],
)
@pytest.mark.asyncio
async def test_mutation_endpoints_reject_unknown_task_status(
    client,
    auth_headers,
    method: str,
    path: str,
    payload: dict,
):
    response = await client.request(method, path, json=payload, headers=auth_headers)

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "enum"


@pytest.mark.asyncio
async def test_list_filter_rejects_unknown_task_status(client, auth_headers):
    response = await client.get(
        "/api/todos",
        params={"status": "blocked"},
        headers=auth_headers,
    )

    assert response.status_code == 422


def test_model_rejects_invalid_status_before_flush():
    with pytest.raises(ValueError, match="Invalid task status"):
        Todo(title="Invalid", status="blocked")


def test_model_default_and_constraint_share_canonical_status_definition():
    assert Todo.__table__.c.status.default.arg == TaskStatus.PENDING
    status_constraint = next(
        constraint
        for constraint in Todo.__table__.constraints
        if isinstance(constraint, CheckConstraint)
        and constraint.name == "ck_todos_status_valid"
    )
    assert str(status_constraint.sqltext) == TASK_STATUS_CHECK_SQL


@pytest.mark.asyncio
async def test_database_constraint_rejects_invalid_raw_status(db_session: AsyncSession):
    with pytest.raises(IntegrityError, match="ck_todos_status_valid"):
        await db_session.execute(
            text(
                "INSERT INTO todos "
                "(id, title, status, priority, sort_order, inbox_state, "
                "created_at, updated_at) "
                "VALUES ('todo_invalid', 'Invalid', 'blocked', 'medium', 0, 'none', :now, :now)"
            ),
            {"now": "2026-08-27T00:00:00+00:00"},
        )
        await db_session.flush()

    await db_session.rollback()


def test_openapi_exposes_named_task_status_component():
    status_schema = app.openapi()["components"]["schemas"]["TaskStatus"]

    assert status_schema["type"] == "string"
    assert status_schema["enum"] == [status.value for status in TaskStatus]


@pytest.mark.parametrize("status", [TaskStatus.COMPLETED, TaskStatus.CANCELLED])
def test_terminal_task_has_no_next_action(status: TaskStatus):
    assert get_next_action("captured", status) is None
