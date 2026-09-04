"""First-class Project API and revision-isolation coverage."""

import json

import pytest

from database import _backfill_first_class_projects
from domain.plan_proposal import PlanProposalStatus
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.plan_proposal import PlanProposal
from models.project import Project
from models.todo import Todo
from schemas.task import PlanPayload
from sqlalchemy import select


async def _create_project(client, auth_headers, title: str) -> dict:
    response = await client.post(
        "/api/projects",
        headers=auth_headers,
        json={"title": title, "goal": f"Ship {title}"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_project_api_creates_distinct_identity_and_root_task(
    client,
    auth_headers,
    db_session,
):
    created = await _create_project(client, auth_headers, "Paper submission")

    assert created["id"].startswith("project_")
    assert created["root_task_id"].startswith("todo_")
    assert created["id"] != created["root_task_id"]
    assert created["graph_revision"] >= 1
    root = await db_session.get(Todo, created["root_task_id"])
    assert root is not None
    assert root.project_id == created["id"]
    assert root.source == "project_root"

    detail = await client.get(
        f"/api/projects/{created['id']}",
        headers=auth_headers,
    )
    assert detail.status_code == 200
    assert detail.json()["task_count"] == 0
    assert detail.json()["ready_count"] == 0


@pytest.mark.asyncio
async def test_project_tasks_inherit_scope_and_can_be_filtered(
    client,
    auth_headers,
):
    project = await _create_project(client, auth_headers, "Scoped work")
    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "First task",
            "parent_id": project["root_task_id"],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["project_id"] == project["id"]

    listed = await client.get(
        "/api/todos",
        headers=auth_headers,
        params={"project_id": project["id"], "limit": 100},
    )
    assert listed.status_code == 200
    assert {item["id"] for item in listed.json()["items"]} == {
        project["root_task_id"],
        created.json()["id"],
    }

    conversation = await client.post(
        "/api/chat/conversations",
        headers=auth_headers,
        json={"title": "Project chat", "project_id": project["id"]},
    )
    assert conversation.status_code == 201
    assert conversation.json()["project_id"] == project["id"]
    assert conversation.json()["project_todo_id"] == project["root_task_id"]


@pytest.mark.asyncio
async def test_same_project_change_stales_plan_apply(
    client,
    auth_headers,
    db_session,
):
    project = await _create_project(client, auth_headers, "Revision scope")
    project_row = await db_session.get(Project, project["id"])
    assert project_row is not None
    payload = PlanPayload.model_validate(
        {"summary": "Plan", "subtasks": [{"title": "Generated"}]}
    ).model_dump(mode="json")
    task = AgentTask(
        id="task_stale_plan",
        task_type="plan_todo",
        agent_type="plan",
        instruction="Plan",
        status="completed",
        todo_id=project["root_task_id"],
        payload_json=json.dumps(payload),
    )
    proposal = PlanProposal(
        id="proposal_stale_project",
        project_id=project["id"],
        root_task_id=project["root_task_id"],
        agent_task_id=task.id,
        base_graph_revision=project_row.graph_revision,
        payload_json=json.dumps(payload),
        validation_json='{"errors": [], "warnings": []}',
        status=PlanProposalStatus.DRAFT,
    )
    db_session.add_all([task, proposal])
    await db_session.commit()

    changed = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Concurrent edit", "parent_id": project["root_task_id"]},
    )
    assert changed.status_code == 201
    applied = await client.post(
        f"/api/todos/{project['root_task_id']}/plan/apply",
        headers=auth_headers,
        json={
            "proposal_id": proposal.id,
            "base_graph_revision": proposal.base_graph_revision,
        },
    )
    assert applied.status_code == 409
    assert applied.json()["error"]["code"] == "STALE_PLAN_PROPOSAL"


@pytest.mark.asyncio
async def test_unrelated_project_change_does_not_stale_plan_apply(
    client,
    auth_headers,
    db_session,
):
    first = await _create_project(client, auth_headers, "First")
    second = await _create_project(client, auth_headers, "Second")
    first_project = await db_session.get(Project, first["id"])
    assert first_project is not None

    payload = PlanPayload.model_validate(
        {"summary": "Scoped plan", "subtasks": [{"title": "Generated"}]}
    ).model_dump(mode="json")
    agent_task = AgentTask(
        id="task_scoped_plan",
        task_type="plan_todo",
        agent_type="plan",
        instruction="Plan",
        status="completed",
        todo_id=first["root_task_id"],
        payload_json=json.dumps(payload),
    )
    proposal = PlanProposal(
        id="proposal_scoped",
        project_id=first["id"],
        root_task_id=first["root_task_id"],
        agent_task_id=agent_task.id,
        base_graph_revision=first_project.graph_revision,
        payload_json=json.dumps(payload),
        validation_json='{"errors": [], "warnings": []}',
        status=PlanProposalStatus.DRAFT,
    )
    db_session.add_all([agent_task, proposal])
    await db_session.commit()

    other_change = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "Unrelated task",
            "parent_id": second["root_task_id"],
        },
    )
    assert other_change.status_code == 201

    applied = await client.post(
        f"/api/todos/{first['root_task_id']}/plan/apply",
        headers=auth_headers,
        json={
            "proposal_id": proposal.id,
            "base_graph_revision": proposal.base_graph_revision,
        },
    )
    assert applied.status_code == 200, applied.text
    generated = list(
        (
            await db_session.execute(
                select(Todo).where(
                    Todo.parent_id == first["root_task_id"],
                    Todo.title == "Generated",
                )
            )
        ).scalars().all()
    )
    assert len(generated) == 1
    assert generated[0].project_id == first["id"]


@pytest.mark.asyncio
async def test_deleting_a_project_hands_its_tasks_back_to_the_inbox(
    client, auth_headers, db_session
):
    created = await _create_project(client, auth_headers, "Wrong project")
    root_id = created["root_task_id"]
    for title, parent in (("Under root", root_id), ("Standalone", None)):
        response = await client.post(
            "/api/todos",
            headers=auth_headers,
            json={"title": title, "project_id": created["id"], "parent_id": parent},
        )
        assert response.status_code == 201, response.text
    done = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Already done", "project_id": created["id"], "status": "completed"},
    )
    assert done.status_code == 201, done.text

    response = await client.delete(f"/api/projects/{created['id']}", headers=auth_headers)
    assert response.status_code == 204, response.text

    assert await db_session.get(Project, created["id"]) is None
    assert await db_session.get(Todo, root_id) is None
    remaining = {
        todo.title: todo
        for todo in (await db_session.execute(select(Todo))).scalars().all()
    }
    assert set(remaining) == {"Under root", "Standalone", "Already done"}
    for todo in remaining.values():
        assert todo.project_id is None
        assert todo.parent_id is None
    assert remaining["Under root"].inbox_state == "captured"
    assert remaining["Standalone"].inbox_state == "captured"
    assert remaining["Already done"].inbox_state == "none"

    listed = await client.get("/api/projects", headers=auth_headers)
    assert created["id"] not in {project["id"] for project in listed.json()}


@pytest.mark.asyncio
async def test_renaming_the_root_task_renames_the_project(client, auth_headers, db_session):
    created = await _create_project(client, auth_headers, "Old name")

    response = await client.patch(
        f"/api/todos/{created['root_task_id']}",
        headers=auth_headers,
        json={"title": "New name", "description": "Why it matters"},
    )
    assert response.status_code == 200, response.text

    project = await db_session.get(Project, created["id"])
    await db_session.refresh(project)
    assert project.title == "New name"
    assert project.description == "Why it matters"

    # And the project page's own rename still reaches the root task.
    response = await client.patch(
        f"/api/projects/{created['id']}",
        headers=auth_headers,
        json={"title": "Final name", "goal": "Ship it"},
    )
    assert response.status_code == 200, response.text
    root = await db_session.get(Todo, created["root_task_id"])
    await db_session.refresh(root)
    assert root.title == "Final name"


@pytest.mark.asyncio
async def test_a_project_root_cannot_be_deleted_as_a_task(client, auth_headers, db_session):
    created = await _create_project(client, auth_headers, "Keep me")

    response = await client.delete(
        f"/api/todos/{created['root_task_id']}", headers=auth_headers
    )

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "PROJECT_ROOT_TASK"
    assert await db_session.get(Todo, created["root_task_id"]) is not None
    project = await db_session.get(Project, created["id"])
    assert project is not None and project.root_task_id == created["root_task_id"]


@pytest.mark.asyncio
async def test_startup_backfill_leaves_plain_captures_alone(db_session):
    """A quick capture is provenance, not a workspace: it must not become a
    Project on the next restart. Obsidian project notes still do."""
    capture = Todo(id="todo_capture", title="Buy printer paper", source="quick_capture",
                   inbox_state="captured")
    standalone = Todo(id="todo_standalone", title="Call the bank")
    note = Todo(id="todo_note", title="Thesis", source="obsidian_project")
    db_session.add_all([capture, standalone, note])
    await db_session.commit()

    await _backfill_first_class_projects(db_session)
    await db_session.commit()

    promoted = {
        project.root_task_id
        for project in (await db_session.execute(select(Project))).scalars().all()
    }
    assert promoted == {note.id}
    await db_session.refresh(capture)
    assert capture.project_id is None
    assert capture.inbox_state == "captured"


@pytest.mark.asyncio
async def test_legacy_root_todo_backfill_is_idempotent(db_session):
    root = Todo(id="todo_legacy_root", title="Legacy project", source="obsidian_project")
    child = Todo(id="todo_legacy_child", title="Child", parent_id=root.id)
    conversation = Conversation(
        id="conv_legacy",
        title="Legacy project",
        project_todo_id=root.id,
    )
    db_session.add_all([root, child])
    await db_session.flush()
    db_session.add(conversation)
    await db_session.commit()

    await _backfill_first_class_projects(db_session)
    await db_session.commit()
    await _backfill_first_class_projects(db_session)
    await db_session.commit()

    projects = list(
        (
            await db_session.execute(
                select(Project).where(Project.root_task_id == root.id)
            )
        ).scalars().all()
    )
    assert len(projects) == 1
    await db_session.refresh(root)
    await db_session.refresh(child)
    await db_session.refresh(conversation)
    assert root.project_id == projects[0].id
    assert child.project_id == projects[0].id
    assert conversation.project_id == projects[0].id
