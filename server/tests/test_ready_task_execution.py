"""Explicit Ready-only Task execution contract tests."""

from types import SimpleNamespace

import pytest

from exceptions import AppError
from main import app
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.task_relationship import TaskRelationship
from models.todo import Todo
from services import agent_run_service, task_execution_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def create_project_tree(db_session):
    project = Project(id="project_execute", title="Execute project")
    db_session.add(project)
    await db_session.flush()
    root = Todo(
        id="todo_execute_root",
        project_id=project.id,
        title="Execute project",
    )
    ready = Todo(
        id="todo_execute_ready",
        project_id=project.id,
        parent_id=root.id,
        title="Analyze results",
    )
    db_session.add_all([root, ready])
    await db_session.flush()
    project.root_task_id = root.id
    await db_session.commit()
    return project, root, ready


@pytest.mark.asyncio
async def test_explicit_execution_claims_one_ready_task(
    client, auth_headers, db_session, monkeypatch
):
    project, _root, ready = await create_project_tree(db_session)
    launched: list[str] = []

    def discard_execution(run_id, coroutine):
        launched.append(run_id)
        coroutine.close()

    monkeypatch.setattr(agent_run_service, "launch_execution", discard_execution)
    previous_ai = getattr(app.state, "active_ai", None)
    previous_provider = getattr(app.state, "active_ai_provider", None)
    previous_session_factory = getattr(app.state, "session_factory", None)
    app.state.active_ai = SimpleNamespace(model="test-model")
    app.state.active_ai_provider = "builtin"
    app.state.session_factory = async_sessionmaker(
        db_session.bind,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        response = await client.post(
            f"/api/todos/{ready.id}/delegate",
            headers=auth_headers,
            json={
                "skill_id": "research",
                "execution_provider": "builtin",
                "require_ready": True,
                "approved": True,
            },
        )
    finally:
        if previous_ai is None:
            delattr(app.state, "active_ai")
        else:
            app.state.active_ai = previous_ai
        if previous_provider is None:
            delattr(app.state, "active_ai_provider")
        else:
            app.state.active_ai_provider = previous_provider
        if previous_session_factory is None:
            delattr(app.state, "session_factory")
        else:
            app.state.session_factory = previous_session_factory

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["todo_id"] == ready.id
    assert payload["agent_task_id"] == payload["task_id"]
    assert payload["skill_id"] == "research"
    assert launched == [payload["run_id"]]
    await db_session.refresh(ready)
    assert ready.status == "in_progress"
    runs = list(
        (
            await db_session.execute(
                select(AgentRun)
                .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
                .where(AgentTask.todo_id == ready.id)
            )
        ).scalars()
    )
    assert len(runs) == 1
    assert runs[0].project_id == project.id
    assert runs[0].status == "queued"


@pytest.mark.asyncio
async def test_explicit_execution_rejects_blocked_and_container_tasks(
    client, auth_headers, db_session
):
    project, root, ready = await create_project_tree(db_session)
    prerequisite = Todo(
        id="todo_execute_prerequisite",
        project_id=project.id,
        parent_id=root.id,
        title="Collect data",
    )
    db_session.add(prerequisite)
    await db_session.flush()
    db_session.add(
        TaskRelationship(
            id="relationship_execute_blocked",
            source_task_id=ready.id,
            target_task_id=prerequisite.id,
            type="depends_on",
        )
    )
    await db_session.commit()

    for todo, expected_state, is_container in (
        (ready, "blocked", False),
        (root, "pending", True),
    ):
        response = await client.post(
            f"/api/todos/{todo.id}/delegate",
            headers=auth_headers,
            json={
                "skill_id": "research",
                "require_ready": True,
                "approved": True,
            },
        )
        assert response.status_code == 409, response.text
        error = response.json()["error"]
        assert error["code"] == "TASK_NOT_READY"
        assert error["details"]["execution_state"] == expected_state
        assert error["details"]["is_container"] is is_container


@pytest.mark.asyncio
async def test_explicit_execution_requires_approval_and_rejects_plan_skill(
    client, auth_headers, db_session
):
    _project, _root, ready = await create_project_tree(db_session)

    missing_approval = await client.post(
        f"/api/todos/{ready.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research", "require_ready": True},
    )
    assert missing_approval.status_code == 422

    plan = await client.post(
        f"/api/todos/{ready.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "plan", "require_ready": True, "approved": True},
    )
    assert plan.status_code == 422
    assert plan.json()["error"]["code"] == "PLAN_EXECUTION_UNSUPPORTED"


@pytest.mark.asyncio
async def test_ready_execution_rejects_an_existing_active_run(db_session):
    project, _root, ready = await create_project_tree(db_session)
    agent_task = AgentTask(
        id="agent_task_existing",
        task_type="delegate_research",
        instruction="Research",
        todo_id=ready.id,
    )
    db_session.add(agent_task)
    await db_session.flush()
    run = AgentRun(
        id="run_existing",
        agent_task_id=agent_task.id,
        project_id=project.id,
        attempt=1,
        instruction_snapshot="Research",
        provider="builtin",
        status="queued",
    )
    db_session.add(run)
    await db_session.commit()

    with pytest.raises(AppError) as exc_info:
        await task_execution_service.validate_ready_execution(db_session, ready)
    assert getattr(exc_info.value, "code", None) == "TASK_EXECUTION_ACTIVE"


@pytest.mark.asyncio
async def test_ready_execution_claim_is_single_winner(db_session):
    _project, _root, ready = await create_project_tree(db_session)
    await task_execution_service.claim_ready_execution(db_session, ready.id)
    with pytest.raises(AppError) as exc_info:
        await task_execution_service.claim_ready_execution(db_session, ready.id)
    assert getattr(exc_info.value, "code", None) == "TASK_EXECUTION_CONFLICT"
