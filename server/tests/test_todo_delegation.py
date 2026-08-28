"""Characterization tests for POST /api/todos/{id}/delegate.

The endpoint carries 190 lines of untested branching -- skill resolution,
readiness gating, provider selection, and two different execution paths. These
pin the current behaviour so it can be moved out of the router safely.
"""

import json

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from domain.task import TaskStatus
from main import app
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.todo import Todo
from utils import make_id


class StubAI:
    model = "stub-model"

    async def stream_completion(self, messages):
        yield ""

    async def generate_title(self, content: str) -> str:
        return "Title"


def _restore_state(key: str, previous):
    if previous is None:
        try:
            delattr(app.state, key)
        except (AttributeError, KeyError):
            pass
    else:
        setattr(app.state, key, previous)


@pytest_asyncio.fixture(autouse=True)
async def delegation_runtime(session_factory, monkeypatch):
    """Supply the app.state wiring lifespan would install, and keep the
    background execution from actually running an agent."""
    launched: list[str] = []

    def _capture(run_id, coroutine):
        launched.append(run_id)
        coroutine.close()  # never scheduled, so close it to avoid a warning

    monkeypatch.setattr("services.agent_run_service.launch_execution", _capture)

    previous = {
        key: getattr(app.state, key, None)
        for key in ("session_factory", "ai_service", "active_ai", "active_ai_provider")
    }
    app.state.session_factory = session_factory
    app.state.ai_service = StubAI()
    app.state.active_ai = app.state.ai_service
    app.state.active_ai_provider = "openclaw"
    try:
        yield launched
    finally:
        for key, value in previous.items():
            _restore_state(key, value)


async def _todo(db, **overrides) -> Todo:
    todo = Todo(
        id=make_id("todo_"),
        title="Draft the launch note",
        status=TaskStatus.PENDING,
        priority="medium",
        **overrides,
    )
    db.add(todo)
    await db.commit()
    return todo


# --- skill resolution -----------------------------------------------------


async def test_delegating_with_a_skill_id(client: AsyncClient, auth_headers, db_session):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "delegated"
    assert body["skill_id"] == "research"
    assert body["skill_chain"] == ["research"]
    # agent_type mirrors skill_id for older clients.
    assert body["agent_type"] == "research"


async def test_legacy_agent_type_maps_to_a_skill(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"agent_type": "researcher"},
    )

    assert resp.status_code == 200
    assert resp.json()["skill_id"] == "research"


async def test_unknown_skill_is_rejected(client: AsyncClient, auth_headers, db_session):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "does-not-exist"},
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "UNKNOWN_SKILL"


async def test_missing_todo_is_a_404(client: AsyncClient, auth_headers):
    resp = await client.post(
        "/api/todos/todo_missing/delegate",
        headers=auth_headers,
        json={"skill_id": "research"},
    )

    assert resp.status_code == 404


# --- side effects on the todo -------------------------------------------


async def test_delegation_records_the_skill_on_the_todo(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session)

    await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research"},
    )

    await db_session.refresh(todo)
    assert todo.assignee == "research"
    assert json.loads(todo.enabled_skills) == ["research"]


async def test_enabled_skills_accumulate_without_duplicates(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session, enabled_skills=json.dumps(["research"]))

    await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "draft"},
    )
    await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "draft"},
    )

    await db_session.refresh(todo)
    assert json.loads(todo.enabled_skills) == ["research", "draft"]


async def test_delegation_creates_one_task_and_one_run(
    client: AsyncClient, auth_headers, db_session, delegation_runtime
):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research"},
    )

    tasks = (await db_session.execute(select(AgentTask))).scalars().all()
    runs = (await db_session.execute(select(AgentRun))).scalars().all()
    assert len(tasks) == 1
    assert len(runs) == 1
    assert tasks[0].todo_id == todo.id
    assert json.loads(tasks[0].skill_chain) == ["research"]
    assert resp.json()["run_id"] == runs[0].id
    # Execution is launched exactly once.
    assert delegation_runtime == [runs[0].id]


# --- readiness gating -----------------------------------------------------


async def test_require_ready_needs_explicit_approval(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research", "require_ready": True},
    )

    assert resp.status_code == 422


async def test_the_plan_skill_cannot_be_executed_as_ready_work(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "plan", "require_ready": True, "approved": True},
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "PLAN_EXECUTION_UNSUPPORTED"


async def test_ready_execution_claims_the_task(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research", "require_ready": True, "approved": True},
    )

    assert resp.status_code == 200
    await db_session.refresh(todo)
    assert todo.status == TaskStatus.IN_PROGRESS


# --- provider selection ---------------------------------------------------


async def test_paseo_requires_it_to_be_enabled(
    client: AsyncClient, auth_headers, db_session
):
    project = Project(id=make_id("proj_"), title="Workspace project")
    db_session.add(project)
    await db_session.commit()
    todo = await _todo(db_session, project_id=project.id)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research", "execution_provider": "paseo"},
    )

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "PASEO_DISABLED"


async def test_delegation_fails_when_no_provider_is_available(
    client: AsyncClient, auth_headers, db_session
):
    todo = await _todo(db_session)
    _restore_state("active_ai", None)
    _restore_state("ai_service", None)

    resp = await client.post(
        f"/api/todos/{todo.id}/delegate",
        headers=auth_headers,
        json={"skill_id": "research"},
    )

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "AI_UNAVAILABLE"
