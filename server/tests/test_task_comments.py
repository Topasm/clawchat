"""API coverage for user-authored task comment threads."""

import pytest


async def _create_todo(client, auth_headers, title: str) -> dict:
    response = await client.post(
        "/api/todos",
        json={"title": title},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _create_comment(client, auth_headers, todo_id: str, content: str) -> dict:
    response = await client.post(
        "/api/task-comments",
        json={"todo_id": todo_id, "content": content},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_comment_create_list_delete(client, auth_headers):
    todo = await _create_todo(client, auth_headers, "Ship the release")

    first = await _create_comment(client, auth_headers, todo["id"], "Starting now")
    assert first["todo_id"] == todo["id"]
    assert first["content"] == "Starting now"
    assert first["created_by"] == "user"

    second = await _create_comment(client, auth_headers, todo["id"], "Halfway through")

    listed = await client.get(
        "/api/task-comments",
        params={"todo_ids": todo["id"]},
        headers=auth_headers,
    )
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [first["id"], second["id"]]

    delete_response = await client.delete(
        f"/api/task-comments/{first['id']}",
        headers=auth_headers,
    )
    assert delete_response.status_code == 204

    remaining = await client.get(
        "/api/task-comments",
        params={"todo_ids": todo["id"]},
        headers=auth_headers,
    )
    assert [item["id"] for item in remaining.json()] == [second["id"]]


@pytest.mark.asyncio
async def test_comment_list_is_scoped_and_bulk_fetchable(client, auth_headers):
    task_a = await _create_todo(client, auth_headers, "Task A")
    task_b = await _create_todo(client, auth_headers, "Task B")

    comment_a = await _create_comment(client, auth_headers, task_a["id"], "on A")
    comment_b = await _create_comment(client, auth_headers, task_b["id"], "on B")

    response = await client.get(
        "/api/task-comments",
        params={"todo_ids": f"{task_a['id']},{task_b['id']}"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert ids == {comment_a["id"], comment_b["id"]}


@pytest.mark.asyncio
async def test_comment_create_rejects_missing_todo(client, auth_headers):
    response = await client.post(
        "/api/task-comments",
        json={"todo_id": "missing-todo", "content": "hello"},
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_comment_create_rejects_blank_content(client, auth_headers):
    todo = await _create_todo(client, auth_headers, "Task")
    response = await client.post(
        "/api/task-comments",
        json={"todo_id": todo["id"], "content": "   "},
        headers=auth_headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_comment_delete_rejects_missing_comment(client, auth_headers):
    response = await client.delete(
        "/api/task-comments/missing-comment",
        headers=auth_headers,
    )
    assert response.status_code == 404
