"""A list row says which unfinished prerequisite a task waits on."""

import pytest


async def _create_todo(client, auth_headers, title: str, **payload) -> dict:
    response = await client.post(
        "/api/todos", json={"title": title, **payload}, headers=auth_headers
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _depends_on(client, auth_headers, source_id: str, target_id: str) -> None:
    response = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": source_id,
            "target_task_id": target_id,
            "type": "depends_on",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_list_names_the_open_prerequisites_of_active_tasks(client, auth_headers):
    read = await _create_todo(client, auth_headers, "Read the problem")
    kernel = await _create_todo(client, auth_headers, "Write the kernel")
    profile = await _create_todo(client, auth_headers, "Profile")
    submit = await _create_todo(client, auth_headers, "Submit")
    await _depends_on(client, auth_headers, kernel["id"], read["id"])
    await _depends_on(client, auth_headers, submit["id"], kernel["id"])
    await _depends_on(client, auth_headers, submit["id"], profile["id"])

    # A completed prerequisite no longer blocks; a cancelled one still does.
    done = await client.patch(
        f"/api/todos/{read['id']}", json={"status": "completed"}, headers=auth_headers
    )
    assert done.status_code == 200, done.text
    cancelled = await client.patch(
        f"/api/todos/{profile['id']}", json={"status": "cancelled"}, headers=auth_headers
    )
    assert cancelled.status_code == 200, cancelled.text

    listed = await client.get("/api/todos", params={"limit": 50}, headers=auth_headers)
    assert listed.status_code == 200, listed.text
    by_id = {item["id"]: item for item in listed.json()["items"]}

    assert by_id[read["id"]]["open_prerequisites"] == []
    assert by_id[kernel["id"]]["open_prerequisites"] == []
    assert by_id[submit["id"]]["open_prerequisites"] == [
        {"id": kernel["id"], "title": "Write the kernel"},
        {"id": profile["id"], "title": "Profile"},
    ]
    # A finished task is not waiting on anything, whatever its edges say.
    assert by_id[profile["id"]]["open_prerequisites"] == []

    single = await client.get(f"/api/todos/{submit['id']}", headers=auth_headers)
    assert single.status_code == 200, single.text
    assert [entry["title"] for entry in single.json()["open_prerequisites"]] == [
        "Write the kernel",
        "Profile",
    ]
