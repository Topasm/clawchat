"""Last-write-wins behavior for edits replayed after a mobile disconnect."""

from datetime import timedelta, timezone

import pytest

from models.todo import Todo


@pytest.mark.asyncio
async def test_newer_server_edit_rejects_an_older_offline_patch(
    client,
    auth_headers,
    db_session,
):
    todo = Todo(title="Desktop edit")
    db_session.add(todo)
    await db_session.commit()
    await db_session.refresh(todo)
    server_updated_at = todo.updated_at
    if server_updated_at.tzinfo is None:
        server_updated_at = server_updated_at.replace(tzinfo=timezone.utc)

    response = await client.patch(
        f"/api/todos/{todo.id}",
        json={
            "title": "Older phone edit",
            "client_updated_at": (server_updated_at - timedelta(minutes=1)).isoformat(),
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Desktop edit"


@pytest.mark.asyncio
async def test_newer_offline_patch_is_applied_after_reconnect(
    client,
    auth_headers,
    db_session,
):
    todo = Todo(title="Old desktop edit")
    db_session.add(todo)
    await db_session.commit()
    await db_session.refresh(todo)
    server_updated_at = todo.updated_at
    if server_updated_at.tzinfo is None:
        server_updated_at = server_updated_at.replace(tzinfo=timezone.utc)

    response = await client.patch(
        f"/api/todos/{todo.id}",
        json={
            "title": "Newest phone edit",
            "client_updated_at": (server_updated_at + timedelta(minutes=1)).isoformat(),
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Newest phone edit"
