"""Atomic Inbox/Tree task placement coverage."""

import pytest
from datetime import datetime, timezone
from exceptions import ConflictError, ValidationError
from models.todo import Todo
from services.tasks import graph_insights_service, project_service, task_placement_service
from sqlalchemy import select


@pytest.mark.asyncio
async def test_placement_deadline_is_atomic_and_undoable(client, auth_headers, db_session):
    project = await _project(db_session)
    task = Todo(title="금요일까지 논문 초안", inbox_state="captured")
    db_session.add(task)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    body = {"project_id": project.id, "parent_id": None, "inbox_state": "none",
            "due_date": "2026-09-04T23:59:59+09:00", "expected_graph_revision": revision}
    result = await client.post(f"/api/todos/{task.id}/placement", headers=auth_headers, json=body)
    assert result.status_code == 200, result.text
    await db_session.refresh(task)
    assert task.project_id == project.id
    assert task.due_date.replace(tzinfo=timezone.utc) == datetime(2026, 9, 4, 14, 59, 59, tzinfo=timezone.utc)
    stale = await client.post(f"/api/todos/{task.id}/placement", headers=auth_headers,
                             json={**body, "due_date": "2026-09-11T14:59:59Z"})
    assert stale.status_code == 409
    undone = await client.post(f"/api/todos/placements/{result.json()['change_set_id']}/undo", headers=auth_headers)
    assert undone.status_code == 200, undone.text
    await db_session.refresh(task)
    assert task.project_id is None
    assert task.due_date is None
    assert task.inbox_state == "captured"


async def _project(db_session, title: str = "Project"):
    project = await project_service.create_project(db_session, title=title)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.mark.asyncio
async def test_place_inbox_task_under_parent_and_undo(db_session):
    project = await _project(db_session)
    parent = Todo(title="Paper", project_id=project.id, sort_order=0)
    existing = Todo(
        title="Existing", project_id=project.id, parent_id=None, sort_order=0
    )
    inbox = Todo(title="Figure", inbox_state="captured", sort_order=0)
    db_session.add_all([parent, existing, inbox])
    await db_session.commit()

    revision = await task_placement_service.current_graph_revision(db_session)
    moved, change, affected, delta = await task_placement_service.place_task(
        db_session,
        todo_id=inbox.id,
        project_id=project.id,
        parent_id=parent.id,
        before_id=None,
        inbox_state="none",
        expected_graph_revision=revision,
    )
    await db_session.commit()

    assert moved.project_id == project.id
    assert moved.parent_id == parent.id
    assert moved.inbox_state == "none"
    assert inbox.id in affected
    assert change.applied_graph_revision > revision
    assert delta is not None

    restored, reverted, _, _ = await task_placement_service.undo_placement(
        db_session,
        change.id,
    )
    await db_session.commit()
    assert restored.project_id is None
    assert restored.parent_id is None
    assert restored.inbox_state == "captured"
    assert reverted.status == "reverted"


@pytest.mark.asyncio
async def test_reorder_inserts_before_target(db_session):
    project = await _project(db_session)
    first = Todo(
        title="First",
        project_id=project.id,
        parent_id=project.root_task_id,
        sort_order=0,
    )
    second = Todo(
        title="Second",
        project_id=project.id,
        parent_id=project.root_task_id,
        sort_order=10,
    )
    third = Todo(
        title="Third",
        project_id=project.id,
        parent_id=project.root_task_id,
        sort_order=20,
    )
    db_session.add_all([first, second, third])
    await db_session.commit()

    revision = await task_placement_service.current_graph_revision(db_session)
    _, change, _, _ = await task_placement_service.place_task(
        db_session,
        todo_id=third.id,
        project_id=project.id,
        parent_id=None,
        before_id=second.id,
        inbox_state="none",
        expected_graph_revision=revision,
    )
    await db_session.commit()

    assert first.sort_order == 0
    assert third.sort_order == 10
    assert second.sort_order == 20

    await task_placement_service.undo_placement(db_session, change.id)
    await db_session.commit()
    assert first.sort_order == 0
    assert second.sort_order == 10
    assert third.sort_order == 20


@pytest.mark.asyncio
async def test_project_root_drop_uses_compatibility_root(db_session):
    project = await _project(db_session)
    inbox = Todo(title="Top-level task", inbox_state="questioning")
    db_session.add(inbox)
    await db_session.commit()

    revision = await task_placement_service.current_graph_revision(db_session)
    moved, _, _, _ = await task_placement_service.place_task(
        db_session,
        todo_id=inbox.id,
        project_id=project.id,
        parent_id=None,
        before_id=None,
        inbox_state="questioning",
        expected_graph_revision=revision,
    )
    await db_session.commit()

    assert moved.project_id == project.id
    assert moved.parent_id == project.root_task_id
    assert moved.inbox_state == "questioning"
    insights = await graph_insights_service.get_graph_insights(
        db_session,
        root_task_id=project.root_task_id,
    )
    assert inbox.id in {node.task_id for node in insights.nodes}


@pytest.mark.asyncio
async def test_move_updates_entire_subtree_project(db_session):
    source = await _project(db_session, "Source")
    target = await _project(db_session, "Target")
    parent = Todo(title="Workstream", project_id=source.id)
    child = Todo(title="Task", project_id=source.id)
    db_session.add(parent)
    await db_session.flush()
    child.parent_id = parent.id
    db_session.add(child)
    await db_session.commit()

    revision = await task_placement_service.current_graph_revision(db_session)
    await task_placement_service.place_task(
        db_session,
        todo_id=parent.id,
        project_id=target.id,
        parent_id=None,
        before_id=None,
        inbox_state="none",
        expected_graph_revision=revision,
    )
    await db_session.commit()
    assert parent.project_id == target.id
    assert parent.parent_id == target.root_task_id
    assert child.project_id == target.id


@pytest.mark.asyncio
async def test_undo_rejects_later_inbox_state_change(db_session):
    project = await _project(db_session)
    inbox = Todo(title="Pipeline task", inbox_state="captured")
    db_session.add(inbox)
    await db_session.commit()

    revision = await task_placement_service.current_graph_revision(db_session)
    _, change, _, _ = await task_placement_service.place_task(
        db_session,
        todo_id=inbox.id,
        project_id=project.id,
        parent_id=None,
        before_id=None,
        inbox_state="none",
        expected_graph_revision=revision,
    )
    await db_session.commit()

    inbox.inbox_state = "questioning"
    await db_session.commit()
    with pytest.raises(ConflictError, match="placement fields changed later"):
        await task_placement_service.undo_placement(db_session, change.id)


@pytest.mark.asyncio
async def test_rejects_parent_cycle_and_stale_revision(db_session):
    project = await _project(db_session)
    parent = Todo(title="Parent", project_id=project.id)
    db_session.add(parent)
    await db_session.flush()
    child = Todo(title="Child", project_id=project.id, parent_id=parent.id)
    db_session.add(child)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    child_id = child.id
    project_id = project.id

    with pytest.raises(ValidationError, match="parent cycle"):
        await task_placement_service.place_task(
            db_session,
            todo_id=parent.id,
            project_id=project.id,
            parent_id=child.id,
            before_id=None,
            inbox_state="none",
            expected_graph_revision=revision,
        )
    await db_session.rollback()

    with pytest.raises(ConflictError, match="refresh and retry"):
        await task_placement_service.place_task(
            db_session,
            todo_id=child_id,
            project_id=project_id,
            parent_id=None,
            before_id=None,
            inbox_state="none",
            expected_graph_revision=revision - 1,
        )


@pytest.mark.asyncio
async def test_batch_placement_preserves_request_order_and_undoes_atomically(
    db_session,
):
    project = await _project(db_session)
    parent = Todo(title="Experiments", project_id=project.id)
    first = Todo(title="First Inbox", inbox_state="captured", sort_order=0)
    second = Todo(title="Second Inbox", inbox_state="captured", sort_order=10)
    db_session.add_all([parent, first, second])
    await db_session.flush()
    existing = Todo(
        title="Existing",
        project_id=project.id,
        parent_id=parent.id,
        sort_order=0,
    )
    db_session.add(existing)
    await db_session.commit()

    revision = await task_placement_service.current_graph_revision(db_session)
    moved, change, affected, _ = await task_placement_service.place_tasks(
        db_session,
        todo_ids=[second.id, first.id],
        project_id=project.id,
        parent_id=parent.id,
        before_id=existing.id,
        inbox_state="none",
        expected_graph_revision=revision,
    )
    await db_session.commit()

    assert [todo.id for todo in moved] == [second.id, first.id]
    assert [second.sort_order, first.sort_order, existing.sort_order] == [0, 10, 20]
    assert second.project_id == first.project_id == project.id
    assert second.parent_id == first.parent_id == parent.id
    assert {first.id, second.id}.issubset(affected)

    await task_placement_service.undo_placement(db_session, change.id)
    await db_session.commit()
    assert first.project_id is None
    assert second.project_id is None
    assert first.inbox_state == second.inbox_state == "captured"
    assert existing.sort_order == 0


@pytest.mark.asyncio
async def test_batch_placement_rejects_overlapping_subtrees_without_changes(db_session):
    project = await _project(db_session)
    parent = Todo(title="Parent", inbox_state="captured")
    db_session.add(parent)
    await db_session.flush()
    child = Todo(title="Child", parent_id=parent.id, inbox_state="captured")
    db_session.add(child)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)

    with pytest.raises(ValidationError, match="descendant"):
        await task_placement_service.place_tasks(
            db_session,
            todo_ids=[parent.id, child.id],
            project_id=project.id,
            parent_id=None,
            before_id=None,
            inbox_state="none",
            expected_graph_revision=revision,
        )
    await db_session.rollback()
    await db_session.refresh(parent)
    await db_session.refresh(child)
    assert parent.project_id is None
    assert child.project_id is None
    assert child.parent_id == parent.id
    assert await task_placement_service.current_graph_revision(db_session) == revision


@pytest.mark.asyncio
async def test_placement_http_contract_and_undo(client, auth_headers, db_session):
    project = await _project(db_session)
    parent = Todo(title="Figures", project_id=project.id)
    inbox = Todo(title="Fix figure", inbox_state="captured")
    db_session.add_all([parent, inbox])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)

    response = await client.post(
        f"/api/todos/{inbox.id}/placement",
        headers=auth_headers,
        json={
            "project_id": project.id,
            "parent_id": parent.id,
            "before_id": None,
            "inbox_state": "none",
            "expected_graph_revision": revision,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["todo"]["project_id"] == project.id
    assert payload["todo"]["parent_id"] == parent.id
    assert payload["insights_delta"] is not None

    undone = await client.post(
        f"/api/todos/placements/{payload['change_set_id']}/undo",
        headers=auth_headers,
    )
    assert undone.status_code == 200, undone.text
    assert undone.json()["todo"]["project_id"] is None
    assert undone.json()["reverted"] is True

    openapi = (await client.get("/openapi.json")).json()
    assert "/api/todos/{todo_id}/placement" in openapi["paths"]
    assert "/api/todos/placements/batch" in openapi["paths"]


@pytest.mark.asyncio
async def test_batch_placement_http_contract_and_shared_undo(
    client, auth_headers, db_session
):
    project = await _project(db_session)
    first = Todo(title="Batch one", inbox_state="captured")
    second = Todo(title="Batch two", inbox_state="captured")
    db_session.add_all([first, second])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)

    response = await client.post(
        "/api/todos/placements/batch",
        headers=auth_headers,
        json={
            "todo_ids": [first.id, second.id],
            "project_id": project.id,
            "parent_id": None,
            "before_id": None,
            "inbox_state": "none",
            "expected_graph_revision": revision,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [todo["id"] for todo in payload["todos"]] == [first.id, second.id]
    assert all(todo["project_id"] == project.id for todo in payload["todos"])
    assert payload["graph_revision"] > revision

    undone = await client.post(
        f"/api/todos/placements/{payload['change_set_id']}/undo",
        headers=auth_headers,
    )
    assert undone.status_code == 200, undone.text
    await db_session.refresh(first)
    await db_session.refresh(second)
    assert first.project_id is None
    assert second.project_id is None


@pytest.mark.asyncio
async def test_grouped_placement_applies_multiple_destinations_with_one_undo(
    client, auth_headers, db_session
):
    project = await _project(db_session)
    paper = Todo(title="Paper", project_id=project.id)
    experiments = Todo(title="Experiments", project_id=project.id)
    first = Todo(title="Fix figure", inbox_state="captured")
    second = Todo(title="Run ablation", inbox_state="captured")
    db_session.add_all([paper, experiments, first, second])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)

    response = await client.post(
        "/api/todos/placements/groups",
        headers=auth_headers,
        json={
            "groups": [
                {
                    "todo_ids": [first.id],
                    "project_id": project.id,
                    "parent_id": paper.id,
                    "inbox_state": "none",
                },
                {
                    "todo_ids": [second.id],
                    "project_id": project.id,
                    "parent_id": experiments.id,
                    "inbox_state": "none",
                },
            ],
            "expected_graph_revision": revision,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [todo["id"] for todo in payload["todos"]] == [first.id, second.id]
    assert payload["todos"][0]["parent_id"] == paper.id
    assert payload["todos"][1]["parent_id"] == experiments.id

    undone = await client.post(
        f"/api/todos/placements/{payload['change_set_id']}/undo",
        headers=auth_headers,
    )
    assert undone.status_code == 200, undone.text
    await db_session.refresh(first)
    await db_session.refresh(second)
    assert first.project_id is second.project_id is None
    assert first.parent_id is second.parent_id is None
    assert first.inbox_state == second.inbox_state == "captured"

    openapi = (await client.get("/openapi.json")).json()
    assert "/api/todos/placements/groups" in openapi["paths"]


@pytest.mark.asyncio
async def test_grouped_placement_rolls_back_all_groups_when_later_group_fails(
    client, auth_headers, db_session
):
    project = await _project(db_session)
    inbox = Todo(title="Valid first group", inbox_state="captured")
    db_session.add(inbox)
    await db_session.commit()
    inbox_id = inbox.id
    revision = await task_placement_service.current_graph_revision(db_session)

    response = await client.post(
        "/api/todos/placements/groups",
        headers=auth_headers,
        json={
            "groups": [
                {
                    "todo_ids": [inbox_id],
                    "project_id": project.id,
                    "parent_id": None,
                    "inbox_state": "none",
                    "create_parent": {
                        "title": "Should roll back",
                        "description": None,
                        "parent_id": None,
                    },
                },
                {
                    "todo_ids": ["todo_missing"],
                    "project_id": project.id,
                    "parent_id": None,
                    "inbox_state": "none",
                },
            ],
            "expected_graph_revision": revision,
        },
    )
    assert response.status_code == 404, response.text
    db_session.expire_all()
    restored = await db_session.get(Todo, inbox_id)
    assert restored is not None
    assert restored.project_id is None
    assert restored.parent_id is None
    assert restored.inbox_state == "captured"
    created = list(
        (
            await db_session.execute(
                select(Todo).where(Todo.source == "ai_triage_workstream")
            )
        ).scalars()
    )
    assert created == []
    assert await task_placement_service.current_graph_revision(db_session) == revision


@pytest.mark.asyncio
async def test_grouped_placement_rejects_duplicate_membership(client, auth_headers):
    response = await client.post(
        "/api/todos/placements/groups",
        headers=auth_headers,
        json={
            "groups": [
                {"todo_ids": ["todo_1"], "project_id": None, "parent_id": None},
                {"todo_ids": ["todo_1"], "project_id": None, "parent_id": None},
            ],
            "expected_graph_revision": 0,
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_grouped_placement_creates_workstream_and_undo_removes_it(
    client, auth_headers, db_session
):
    project = await _project(db_session)
    first = Todo(title="Format paper", inbox_state="captured")
    second = Todo(title="Check deadline", inbox_state="captured")
    db_session.add_all([first, second])
    await db_session.commit()
    first_id = first.id
    second_id = second.id
    revision = await task_placement_service.current_graph_revision(db_session)

    response = await client.post(
        "/api/todos/placements/groups",
        headers=auth_headers,
        json={
            "groups": [
                {
                    "todo_ids": [first_id, second_id],
                    "project_id": project.id,
                    "parent_id": None,
                    "inbox_state": "none",
                    "create_parent": {
                        "title": "Submission",
                        "description": "AI-proposed Workstream",
                        "parent_id": None,
                    },
                }
            ],
            "expected_graph_revision": revision,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["created_todos"]) == 1
    workstream_id = payload["created_todos"][0]["id"]
    assert payload["created_todos"][0]["source"] == "ai_triage_workstream"
    assert {todo["parent_id"] for todo in payload["todos"]} == {workstream_id}

    undone = await client.post(
        f"/api/todos/placements/{payload['change_set_id']}/undo",
        headers=auth_headers,
    )
    assert undone.status_code == 200, undone.text
    db_session.expire_all()
    assert await db_session.get(Todo, workstream_id) is None
    restored_first = await db_session.get(Todo, first_id)
    restored_second = await db_session.get(Todo, second_id)
    assert restored_first is not None and restored_first.project_id is None
    assert restored_second is not None and restored_second.project_id is None
