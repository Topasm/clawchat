"""Steps in a task's flow: chained on append, forked on branch, undoable."""

import pytest


async def _task(client, auth_headers, title: str = "GPU homework") -> str:
    response = await client.post(
        "/api/todos",
        json={"title": title, "inbox_state": "none"},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _step(client, auth_headers, parent_id: str, title: str, **body) -> dict:
    response = await client.post(
        f"/api/todos/{parent_id}/steps",
        json={"title": title, **body},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _edges(client, auth_headers) -> set[tuple[str, str]]:
    response = await client.get(
        "/api/task-relationships",
        params={"type": "depends_on"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    rows = body["items"] if isinstance(body, dict) else body
    return {(row["source_task_id"], row["target_task_id"]) for row in rows}


@pytest.mark.asyncio
async def test_steps_typed_in_a_row_form_a_chain(client, auth_headers):
    parent = await _task(client, auth_headers)
    ids = [
        (await _step(client, auth_headers, parent, title))["todo"]["id"]
        for title in ("Read", "Write kernel", "Profile", "Submit")
    ]

    assert await _edges(client, auth_headers) == {
        (ids[1], ids[0]),
        (ids[2], ids[1]),
        (ids[3], ids[2]),
    }
    todo = (await client.get(f"/api/todos/{ids[3]}", headers=auth_headers)).json()
    assert todo["parent_id"] == parent
    assert todo["inbox_state"] == "none"


@pytest.mark.asyncio
async def test_branch_makes_the_next_step_wait_for_both(client, auth_headers):
    parent = await _task(client, auth_headers)
    read, kernel, profile, submit = [
        (await _step(client, auth_headers, parent, title))["todo"]["id"]
        for title in ("Read", "Write kernel", "Profile", "Submit")
    ]

    report = (
        await _step(client, auth_headers, parent, "Draft report", branch_from_id=profile)
    )["todo"]["id"]

    edges = await _edges(client, auth_headers)
    assert (report, kernel) in edges
    assert {(submit, profile), (submit, report)} <= edges

    # A step typed after the merge waits only on the flow's end.
    after = (await _step(client, auth_headers, parent, "Celebrate"))["todo"]["id"]
    assert {target for source, target in await _edges(client, auth_headers) if source == after} == {submit}
    assert read


@pytest.mark.asyncio
async def test_append_after_two_open_branches_joins_them(client, auth_headers):
    parent = await _task(client, auth_headers)
    first = (await _step(client, auth_headers, parent, "Start"))["todo"]["id"]
    left = (await _step(client, auth_headers, parent, "Left"))["todo"]["id"]
    right = (
        await _step(client, auth_headers, parent, "Right", branch_from_id=left)
    )["todo"]["id"]
    join = (await _step(client, auth_headers, parent, "Join"))["todo"]["id"]

    edges = await _edges(client, auth_headers)
    assert {(left, first), (right, first), (join, left), (join, right)} == edges


@pytest.mark.asyncio
async def test_undo_removes_the_step_and_its_edges(client, auth_headers):
    parent = await _task(client, auth_headers)
    first = (await _step(client, auth_headers, parent, "One"))["todo"]["id"]
    second = await _step(client, auth_headers, parent, "Two")

    response = await client.post(
        f"/api/todos/step-changes/{second['change_id']}/undo",
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert await _edges(client, auth_headers) == set()
    missing = await client.get(f"/api/todos/{second['todo']['id']}", headers=auth_headers)
    assert missing.status_code == 404
    assert (await client.get(f"/api/todos/{first}", headers=auth_headers)).status_code == 200

    again = await client.post(
        f"/api/todos/step-changes/{second['change_id']}/undo",
        headers=auth_headers,
    )
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_move_rewires_the_chain_and_undo_restores_edge_ids(client, auth_headers):
    parent = await _task(client, auth_headers)
    a, b, c, d = [
        (await _step(client, auth_headers, parent, title))["todo"]["id"]
        for title in ("A", "B", "C", "D")
    ]
    before = await client.get(
        "/api/task-relationships", params={"type": "depends_on"}, headers=auth_headers
    )
    before_rows = before.json()
    before_rows = before_rows["items"] if isinstance(before_rows, dict) else before_rows
    before_ids = {row["id"] for row in before_rows}

    response = await client.post(
        f"/api/todos/{parent}/steps/move",
        json={"step_id": b, "after_id": c},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert await _edges(client, auth_headers) == {(c, a), (b, c), (d, b)}

    children = (
        await client.get("/api/todos", params={"parent_id": parent}, headers=auth_headers)
    ).json()
    items = children["items"] if isinstance(children, dict) else children
    order = [
        item["id"]
        for item in sorted(
            (item for item in items if item.get("parent_id") == parent),
            key=lambda item: item["sort_order"],
        )
    ]
    assert order == [a, c, b, d]

    undo = await client.post(
        f"/api/todos/step-changes/{response.json()['change_id']}/undo",
        headers=auth_headers,
    )
    assert undo.status_code == 200, undo.text
    assert await _edges(client, auth_headers) == {(b, a), (c, b), (d, c)}
    after = await client.get(
        "/api/task-relationships", params={"type": "depends_on"}, headers=auth_headers
    )
    after_rows = after.json()
    after_rows = after_rows["items"] if isinstance(after_rows, dict) else after_rows
    assert {row["id"] for row in after_rows} == before_ids


@pytest.mark.asyncio
async def test_move_to_start_and_bad_targets(client, auth_headers):
    parent = await _task(client, auth_headers)
    other = await _task(client, auth_headers, "Other")
    a, b = [
        (await _step(client, auth_headers, parent, title))["todo"]["id"]
        for title in ("A", "B")
    ]
    response = await client.post(
        f"/api/todos/{parent}/steps/move",
        json={"step_id": b, "after_id": None},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert await _edges(client, auth_headers) == {(a, b)}

    outsider = await client.post(
        f"/api/todos/{parent}/steps",
        json={"title": "X", "branch_from_id": other},
        headers=auth_headers,
    )
    assert outsider.status_code == 400


@pytest.mark.asyncio
async def test_paths_are_listed_with_inherited_parent_paths(client, auth_headers):
    parent = await _task(client, auth_headers)
    child = (await _step(client, auth_headers, parent, "Kernel"))["todo"]["id"]

    created = await client.post(
        f"/api/todos/{parent}/paths",
        json={"kind": "url", "path": "https://example.com/hw3", "label": "Brief"},
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text
    vault = await client.post(
        f"/api/todos/{child}/paths",
        json={"kind": "vault", "path": "01_Projects/hw3.md"},
        headers=auth_headers,
    )
    assert vault.status_code == 201, vault.text

    listed = (await client.get(f"/api/todos/{child}/paths", headers=auth_headers)).json()
    assert [(row["path"], row["inherited"]) for row in listed] == [
        ("01_Projects/hw3.md", False),
        ("https://example.com/hw3", True),
    ]

    unknown_host = await client.post(
        f"/api/todos/{child}/paths",
        json={"kind": "device", "path": "~/hw3", "host_id": "host_missing"},
        headers=auth_headers,
    )
    assert unknown_host.status_code == 400

    deleted = await client.delete(
        f"/api/todos/{child}/paths/{vault.json()['id']}", headers=auth_headers
    )
    assert deleted.status_code == 204
    listed = (await client.get(f"/api/todos/{child}/paths", headers=auth_headers)).json()
    assert [row["inherited"] for row in listed] == [True]


@pytest.mark.asyncio
async def test_unordered_steps_stay_out_of_an_appended_chain(client, auth_headers):
    parent = await _task(client, auth_headers)
    loose = []
    for title in ("Find papers", "Request account"):
        response = await client.post(
            "/api/todos",
            json={"title": title, "parent_id": parent, "inbox_state": "none"},
            headers=auth_headers,
        )
        loose.append(response.json()["id"])

    first = (await _step(client, auth_headers, parent, "Read"))["todo"]["id"]
    second = (await _step(client, auth_headers, parent, "Write"))["todo"]["id"]

    # Nothing was ordered, so the first step follows the newest one only;
    # after that the chain grows from its own end.
    assert await _edges(client, auth_headers) == {(first, loose[1]), (second, first)}


@pytest.mark.asyncio
async def test_after_id_attaches_after_the_chosen_branch_end(client, auth_headers):
    parent = await _task(client, auth_headers)
    start = (await _step(client, auth_headers, parent, "Start"))["todo"]["id"]
    left = (await _step(client, auth_headers, parent, "Left"))["todo"]["id"]
    right = (
        await _step(client, auth_headers, parent, "Right", branch_from_id=left)
    )["todo"]["id"]

    tail = (await _step(client, auth_headers, parent, "Right 2", after_id=right))["todo"]["id"]

    assert await _edges(client, auth_headers) == {
        (left, start),
        (right, start),
        (tail, right),
    }


@pytest.mark.asyncio
async def test_a_cycle_is_refused_with_both_task_names(client, auth_headers):
    parent = await _task(client, auth_headers)
    read = (await _step(client, auth_headers, parent, "Read"))["todo"]["id"]
    submit = (await _step(client, auth_headers, parent, "Submit"))["todo"]["id"]

    response = await client.post(
        "/api/task-relationships",
        json={"source_task_id": read, "target_task_id": submit, "type": "depends_on"},
        headers=auth_headers,
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["details"]["earlier_title"] == "Submit"
    assert error["details"]["later_title"] == "Read"
    assert "“Submit” would come before “Read”" in error["message"]
