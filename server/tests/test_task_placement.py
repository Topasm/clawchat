"""Atomic Inbox/Tree task placement coverage."""

import pytest

from exceptions import ConflictError, ValidationError
from models.todo import Todo
from services import graph_insights_service, project_service, task_placement_service


async def _project(db_session, title: str = "Project"):
    project = await project_service.create_project(db_session, title=title)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.mark.asyncio
async def test_place_inbox_task_under_parent_and_undo(db_session):
    project = await _project(db_session)
    parent = Todo(title="Paper", project_id=project.id, sort_order=0)
    existing = Todo(title="Existing", project_id=project.id, parent_id=None, sort_order=0)
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
