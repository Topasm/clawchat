"""Paseo CLI contract and AgentRun integration coverage."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from execution.paseo_cli import (
    PaseoAgent,
    PaseoAgentSnapshot,
    PaseoCLIAdapter,
    PaseoWorkspace,
)
from domain.review import ReviewStatus
from main import app
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from services import agent_run_service, paseo_execution_service


class FakePaseoAdapter:
    enabled = True
    host_label = "test-daemon:6767"

    def __init__(self, snapshots=None):
        self.snapshots = list(
            snapshots
            or [
                PaseoAgentSnapshot(
                    id="paseo-agent-1",
                    status="running",
                    provider="codex",
                    model="gpt-5.5",
                    cwd="/worktrees/task",
                    worktree="clawchat/task-run",
                    pending_permissions=(),
                    usage={"InputTokens": 20, "OutputTokens": 10, "CostUsd": 0.1},
                ),
                PaseoAgentSnapshot(
                    id="paseo-agent-1",
                    status="idle",
                    provider="codex",
                    model="gpt-5.5",
                    cwd="/worktrees/task",
                    worktree="clawchat/task-run",
                    pending_permissions=(),
                    usage={"InputTokens": 40, "OutputTokens": 30, "CostUsd": 0.2},
                ),
            ]
        )
        self.create_workspace = AsyncMock(
            return_value=PaseoWorkspace(
                id="workspace-1",
                project="Repo",
                name="Task",
                isolation="worktree",
                cwd="/worktrees/task",
            )
        )
        self.start_agent = AsyncMock(
            return_value=PaseoAgent(
                id="paseo-agent-1",
                status="running",
                provider="codex",
                cwd="/worktrees/task",
                title="Implement feature",
            )
        )
        self.stop_agent = AsyncMock()
        self.send_follow_up = AsyncMock()
        self.logs = AsyncMock(return_value="Agent changed 3 files and all tests pass.")

    async def inspect_agent(self, _agent_id):
        if len(self.snapshots) > 1:
            return self.snapshots.pop(0)
        return self.snapshots[0]

    async def health(self):
        return {
            "enabled": True,
            "available": True,
            "connected": True,
            "host": self.host_label,
            "error": None,
            "providers": [{"provider": "codex", "status": "available"}],
        }


async def _project_run(db_session, *, status="queued", external_run_id=None):
    project = Project(
        id="project_paseo",
        title="Paseo project",
        default_execution_provider="paseo",
        default_execution_model="codex/gpt-5.5",
        execution_workspace_path="/repos/clawchat",
        execution_workspace_isolation="worktree",
        execution_base_branch="origin/main",
    )
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_paseo", project_id=project.id, title="Implement feature")
    db_session.add(todo)
    await db_session.flush()
    project.root_task_id = todo.id
    task = AgentTask(
        id="task_paseo",
        task_type="delegate_general",
        instruction="Implement the feature and run tests",
        todo_id=todo.id,
        agent_type="general",
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(
        db_session,
        task,
        provider="paseo",
        model="codex/gpt-5.5",
        host_id="test-daemon:6767",
    )
    run.status = status
    run.external_run_id = external_run_id
    if external_run_id:
        run.workspace_id = "workspace-1"
    await db_session.commit()
    return project, todo, task, run


@pytest.mark.asyncio
async def test_paseo_execution_creates_workspace_artifact_and_review(db_session):
    project, _todo, _task, run = await _project_run(db_session)
    session_factory = async_sessionmaker(
        db_session.bind, class_=AsyncSession, expire_on_commit=False
    )
    adapter = FakePaseoAdapter()
    run_id = run.id
    project_id = project.id

    await paseo_execution_service.execute_run(
        session_factory,
        run_id,
        adapter=adapter,
        poll_interval=0.001,
        reconnect_grace_seconds=0.1,
    )

    db_session.expire_all()
    persisted = await db_session.get(AgentRun, run_id)
    assert persisted.status == "waiting_review"
    assert persisted.external_run_id == "paseo-agent-1"
    assert persisted.workspace_id == "workspace-1"
    assert "all tests pass" in persisted.result
    adapter.create_workspace.assert_awaited_once()
    assert adapter.create_workspace.await_args.kwargs["path"] == "/repos/clawchat"
    assert adapter.create_workspace.await_args.kwargs["base_branch"] == "origin/main"
    adapter.start_agent.assert_awaited_once()
    assert adapter.start_agent.await_args.kwargs["provider_model"] == "codex/gpt-5.5"

    assert (
        await db_session.execute(
            select(Artifact).where(Artifact.created_by == run_id)
        )
    ).scalar_one_or_none() is None
    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.APPROVED)
    await db_session.commit()
    artifact = (
        await db_session.execute(
            select(Artifact).where(Artifact.created_by == run_id)
        )
    ).scalar_one()
    assert artifact.project_id == project_id
    assert artifact.type == "code_diff"
    assert "paseo-agent-1" in artifact.content
    review = (
        await db_session.execute(
            select(ReviewItem).where(ReviewItem.subject_id == run_id)
        )
    ).scalar_one()
    assert review.status == "pending"
    events = list(
        (
            await db_session.execute(
                select(AgentRunEvent)
                .where(AgentRunEvent.run_id == run_id)
                .order_by(AgentRunEvent.sequence)
            )
        ).scalars()
    )
    assert "workspace_created" in {event.event_type for event in events}
    assert "provider_started" in {event.event_type for event in events}


@pytest.mark.asyncio
async def test_paseo_cancel_endpoint_stops_external_agent(
    client, auth_headers, db_session
):
    _project, _todo, _task, run = await _project_run(
        db_session, status="running", external_run_id="paseo-agent-1"
    )
    adapter = FakePaseoAdapter()
    previous = getattr(app.state, "paseo_adapter", None)
    app.state.paseo_adapter = adapter
    try:
        response = await client.post(
            f"/api/runs/{run.id}/cancel", headers=auth_headers
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "cancelled"
        adapter.stop_agent.assert_awaited_once_with("paseo-agent-1")
    finally:
        if previous is None:
            delattr(app.state, "paseo_adapter")
        else:
            app.state.paseo_adapter = previous


@pytest.mark.asyncio
async def test_restart_reconciliation_preserves_reattachable_paseo_run(db_session):
    _project, _todo, _task, run = await _project_run(
        db_session, status="running", external_run_id="paseo-agent-1"
    )
    reconciled = await agent_run_service.reconcile_interrupted_runs(db_session)
    await db_session.commit()
    await db_session.refresh(run)
    assert reconciled == 0
    assert run.status == "running"


@pytest.mark.asyncio
async def test_paseo_waiting_input_resumes_same_external_agent(db_session):
    permission_snapshot = PaseoAgentSnapshot(
        id="paseo-agent-1",
        status="running",
        provider="codex",
        model="gpt-5.5",
        cwd="/worktrees/task",
        worktree="clawchat/task-run",
        pending_permissions=({"id": "permission-1", "tool": "shell"},),
        usage=None,
    )
    idle_snapshot = PaseoAgentSnapshot(
        id="paseo-agent-1",
        status="idle",
        provider="codex",
        model="gpt-5.5",
        cwd="/worktrees/task",
        worktree="clawchat/task-run",
        pending_permissions=(),
        usage=None,
    )
    _project, _todo, _task, run = await _project_run(db_session)
    run_id = run.id
    session_factory = async_sessionmaker(
        db_session.bind, class_=AsyncSession, expire_on_commit=False
    )
    adapter = FakePaseoAdapter([permission_snapshot])

    await paseo_execution_service.execute_run(
        session_factory,
        run_id,
        adapter=adapter,
        poll_interval=0.001,
        reconnect_grace_seconds=0.1,
    )
    db_session.expire_all()
    waiting = await db_session.get(AgentRun, run_id)
    assert waiting.status == "waiting_input"
    assert waiting.external_run_id == "paseo-agent-1"

    adapter.snapshots = [idle_snapshot]
    await paseo_execution_service.resume_external_run(
        session_factory,
        run_id,
        "Run only the focused tests",
        adapter=adapter,
    )
    db_session.expire_all()
    completed = await db_session.get(AgentRun, run_id)
    assert completed.status == "waiting_review"
    assert completed.external_run_id == "paseo-agent-1"
    adapter.send_follow_up.assert_awaited_once_with(
        "paseo-agent-1", "Run only the focused tests"
    )
    adapter.create_workspace.assert_awaited_once()
    adapter.start_agent.assert_awaited_once()


@pytest.mark.asyncio
async def test_execution_provider_endpoint_reports_sanitized_paseo_health(
    client, auth_headers
):
    adapter = FakePaseoAdapter()
    previous = getattr(app.state, "paseo_adapter", None)
    app.state.paseo_adapter = adapter
    try:
        response = await client.get("/api/execution-providers", headers=auth_headers)
        assert response.status_code == 200, response.text
        paseo = next(item for item in response.json() if item["id"] == "paseo")
        assert paseo["connected"] is True
        assert paseo["host"] == "test-daemon:6767"
        assert paseo["providers"][0]["provider"] == "codex"
    finally:
        if previous is None:
            delattr(app.state, "paseo_adapter")
        else:
            app.state.paseo_adapter = previous


@pytest.mark.asyncio
async def test_cli_adapter_passes_prompt_as_single_argv_without_shell(monkeypatch):
    captured = []

    class Process:
        returncode = 0

        async def communicate(self):
            return (
                b'{"agentId":"agent-1","status":"running","provider":"codex","cwd":"/repo","title":"Task"}',
                b"",
            )

        def kill(self):
            return None

    async def create_process(*argv, **kwargs):
        captured.append((argv, kwargs))
        return Process()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    adapter = PaseoCLIAdapter(
        command="/bin/echo",
        host="daemon:6767",
        enabled=True,
    )
    prompt = "fix tests; $(touch /tmp/should-not-run)"
    agent = await adapter.start_agent(
        workspace_id="workspace-1",
        provider_model="codex/gpt-5.5",
        prompt=prompt,
        title="Task",
    )
    assert agent.id == "agent-1"
    argv, kwargs = captured[0]
    assert prompt in argv
    assert argv[0] == "/bin/echo"
    assert "--host" not in argv
    assert kwargs["env"]["PASEO_HOST"] == "daemon:6767"


@pytest.mark.asyncio
async def test_project_default_routes_todo_delegation_to_paseo(
    client, auth_headers, db_session, monkeypatch
):
    project_response = await client.post(
        "/api/projects",
        headers=auth_headers,
        json={
            "title": "Coding project",
            "default_execution_provider": "paseo",
            "default_execution_model": "codex/gpt-5.5",
            "execution_workspace_path": "/repos/coding-project",
            "execution_workspace_isolation": "worktree",
            "execution_base_branch": "origin/main",
        },
    )
    assert project_response.status_code == 201, project_response.text
    project = project_response.json()
    todo_response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Fix authentication", "parent_id": project["root_task_id"]},
    )
    assert todo_response.status_code == 201, todo_response.text

    async def no_op_execution(*_args, **_kwargs):
        return None

    monkeypatch.setattr(paseo_execution_service, "execute_run", no_op_execution)
    state_names = ("paseo_adapter", "session_factory")
    previous = {
        name: getattr(app.state, name) for name in state_names if hasattr(app.state, name)
    }
    app.state.paseo_adapter = FakePaseoAdapter()
    app.state.session_factory = async_sessionmaker(
        db_session.bind, class_=AsyncSession, expire_on_commit=False
    )
    try:
        delegated = await client.post(
            f"/api/todos/{todo_response.json()['id']}/delegate",
            headers=auth_headers,
            json={"skill_id": "research"},
        )
        assert delegated.status_code == 200, delegated.text
        run = await db_session.get(AgentRun, delegated.json()["run_id"])
        assert run.provider == "paseo"
        assert run.model == "codex/gpt-5.5"
        assert run.host_id == "test-daemon:6767"
        await asyncio.sleep(0)
    finally:
        for name in state_names:
            if name in previous:
                setattr(app.state, name, previous[name])
            elif hasattr(app.state, name):
                delattr(app.state, name)
