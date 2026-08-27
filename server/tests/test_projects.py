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
