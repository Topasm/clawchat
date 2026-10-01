"""OpenCode execution backend: sandbox argv, pinned config, and the run bridge."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from domain.review import ReviewStatus
from execution.opencode_server import RUN_PERMISSIONS, bwrap_argv, run_config
from main import app
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, opencode_execution_service

SESSION = "ses_test"
PATCH = "--- a/app.py\n+++ b/app.py\n@@ -1 +1 @@\n-old\n+new\n"


def _event(kind, **properties):
    return {"type": kind, "properties": properties}


def _tool(tool, title, status="completed"):
    return _event(
        "message.part.updated",
        part={
            "sessionID": SESSION,
            "type": "tool",
            "tool": tool,
            "state": {"status": status, "title": title},
        },
    )


DIFFS = [{"file": "app.py", "status": "modified", "additions": 1, "deletions": 1, "patch": PATCH}]


def _messages(text="Renamed the helper and the tests pass.", error=None, diffs=DIFFS):
    summary = {"diffs": diffs} if diffs is not None else None
    return [
        {"info": {"role": "user", "id": "msg_1", "sessionID": SESSION, "summary": summary}, "parts": []},
        {
            "info": {
                "role": "assistant",
                "providerID": "ollama",
                "modelID": "qwen3",
                "tokens": {"input": 120, "output": 30, "reasoning": 0},
                "cost": 0,
                "error": error,
            },
            "parts": [{"type": "text", "text": text}],
        },
    ]


class FakeServer:
    directory = "/repo"

    def __init__(self, events, messages=None, diff=None):
        self._events = events
        self._messages = messages if messages is not None else _messages()
        # OpenCode's session-wide diff can stay empty; the prompt summary is what counts.
        self._diff = diff if diff is not None else []
        self.prompts = []
        self.permission_replies = []
        self.aborted = []

    async def create_session(self, title):
        self.title = title
        return SESSION

    async def prompt(self, session_id, text):
        self.prompts.append((session_id, text))

    async def events(self):
        yield _event("server.connected")
        for event in self._events:
            yield event

    async def reply_permission(self, request_id, reply, message=None):
        self.permission_replies.append((request_id, reply, message))

    async def reject_question(self, request_id):
        pass

    async def abort(self, session_id):
        self.aborted.append(session_id)

    async def messages(self, session_id):
        return self._messages

    async def diff(self, session_id, message_id=None):
        self.diff_requests = getattr(self, "diff_requests", []) + [message_id]
        return self._diff


class FakeAdapter:
    enabled = True
    host_label = "local"

    def __init__(self, server):
        self.server = server
        self.served = []

    @asynccontextmanager
    async def serve(self, workspace, *, config):
        self.served.append((workspace, config))
        yield self.server

    async def health(self):
        return {
            "enabled": True,
            "available": True,
            "connected": True,
            "host": "ClawChat server",
            "error": None,
            "providers": [],
        }


async def _project_run(db_session, workspace: Path, *, model="ollama/qwen3"):
    project = Project(
        id="project_opencode",
        title="OpenCode project",
        default_execution_provider="opencode",
        execution_workspace_path=str(workspace),
    )
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_opencode", project_id=project.id, title="Rename helper")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_opencode",
        task_type="delegate_general",
        instruction="Rename the helper and run the tests",
        todo_id=todo.id,
        agent_type="general",
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(
        db_session, task, provider="opencode", model=model
    )
    await db_session.commit()
    return project, todo, task, run


def _factory(db_session):
    return async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)


async def _events(db_session, run_id):
    return list(
        (
            await db_session.execute(
                select(AgentRunEvent)
                .where(AgentRunEvent.run_id == run_id)
                .order_by(AgentRunEvent.sequence)
            )
        ).scalars()
    )


def test_bwrap_argv_makes_only_named_paths_writable():
    argv = bwrap_argv(
        "/usr/bin/bwrap",
        executable="/usr/local/bin/opencode",
        workspace="/repos/app",
        writable=[Path("/home/u/.local/share/opencode")],
    )
    joined = " ".join(argv)
    assert "--ro-bind / /" in joined
    assert "--bind /repos/app /repos/app" in joined
    assert "--bind /home/u/.local/share/opencode /home/u/.local/share/opencode" in joined
    assert "--unshare-pid" in argv and "--die-with-parent" in argv
    # The private /tmp comes before any bind that might sit beneath it.
    assert argv.index("/tmp") < argv.index("/repos/app")
    assert argv[-2:] == ["--chdir", "/repos/app"]


def test_bwrap_argv_restores_an_install_hidden_by_the_private_tmp(tmp_path):
    modules = tmp_path / "node_modules"
    (modules / ".bin").mkdir(parents=True)
    executable = modules / ".bin" / "opencode"
    executable.write_text("#!/bin/sh\n")
    argv = bwrap_argv(
        "/usr/bin/bwrap", executable=str(executable), workspace="/repos/app", writable=[]
    )
    root = str(modules.resolve())
    assert f"--ro-bind {root} {root}" in " ".join(argv)


def test_run_config_pins_permissions_and_scopes_clawchat_tools():
    config = run_config(
        model="ollama/qwen3",
        tools_url="http://127.0.0.1:8000/api/agent-tools/mcp",
        tools_token="secret",
        tool_timeout_ms=1000,
    )
    assert config["model"] == "ollama/qwen3"
    assert config["permission"] == RUN_PERMISSIONS
    # Nothing is left to ask about: an unanswered prompt would hang the run.
    assert "ask" not in config["permission"].values()
    assert config["permission"]["external_directory"] == "deny"
    server = config["mcp"]["clawchat"]
    assert server["headers"] == {"Authorization": "Bearer secret"}
    assert server["timeout"] == 1000
    assert "mcp" not in run_config(model=None)
    assert "model" not in run_config(model=None)


def test_summarize_reply_reads_only_the_latest_prompt():
    earlier = _messages("old answer")
    latest = _messages("new answer")
    reply = opencode_execution_service.summarize_reply(earlier + latest)
    assert reply["text"] == "new answer"
    assert reply["model"] == "ollama/qwen3"
    assert reply["tokens"]["input"] == 120
    failed = opencode_execution_service.summarize_reply(
        _messages("", error={"name": "ProviderAuthError", "data": {"message": "no key"}})
    )
    assert failed["error"] == "ProviderAuthError: no key"


def test_workspace_problem_refuses_paths_that_are_not_here(tmp_path):
    from services.agents.execution_host_service import WorkspaceResolution

    problem = opencode_execution_service.workspace_problem
    assert problem(WorkspaceResolution(host=None, path=None, is_available=False))[0] == (
        "OPENCODE_WORKSPACE_REQUIRED"
    )
    assert problem(
        WorkspaceResolution(host=None, path=str(tmp_path / "gone"), is_available=True)
    )[0] == "EXECUTION_HOST_UNAVAILABLE"
    assert problem(WorkspaceResolution(host=None, path=str(tmp_path), is_available=True)) is None


@pytest.mark.asyncio
async def test_opencode_run_reaches_review_with_its_diff(db_session, tmp_path):
    project, _todo, _task, run = await _project_run(db_session, tmp_path)
    server = FakeServer(
        [
            _event("session.status", sessionID=SESSION, status={"type": "busy"}),
            _tool("skill", "release-note"),
            _event(
                "permission.asked",
                id="per_1",
                sessionID=SESSION,
                permission="bash",
                patterns=["rm -rf build"],
            ),
            _tool("edit", "app.py"),
            # Another session's traffic on the same server is not this run's.
            _event("session.status", sessionID="ses_other", status={"type": "idle"}),
            _event("session.status", sessionID=SESSION, status={"type": "idle"}),
        ]
    )
    adapter = FakeAdapter(server)
    run_id = run.id

    await opencode_execution_service.execute_run(_factory(db_session), run_id, adapter=adapter)

    db_session.expire_all()
    persisted = await db_session.get(AgentRun, run_id)
    assert persisted.status == "waiting_review", persisted.error
    assert persisted.external_run_id == SESSION
    assert "tests pass" in persisted.result
    assert "app.py (+1 -1)" in persisted.result
    usage = json.loads(persisted.usage_json)
    assert usage["model"] == "ollama/qwen3"
    assert usage["tool_calls"] == 2
    assert usage["patch"] == PATCH

    workspace, config = adapter.served[0]
    assert workspace == str(tmp_path)
    assert config["model"] == "ollama/qwen3"
    assert server.prompts == [(SESSION, persisted.instruction_snapshot)]
    # Unattended: the permission is refused, with a reason the agent can use.
    assert server.permission_replies[0][:2] == ("per_1", "reject")

    kinds = [event.event_type for event in await _events(db_session, run_id)]
    assert "provider_started" in kinds
    assert kinds.count("tool_call") == 2
    assert "permission_denied" in kinds

    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.APPROVED)
    await db_session.commit()
    code_diff = (
        await db_session.execute(
            select(Artifact).where(Artifact.created_by == run_id, Artifact.type == "code_diff")
        )
    ).scalar_one()
    assert code_diff.project_id == project.id
    assert code_diff.content == PATCH
    assert code_diff.source == "opencode"


@pytest.mark.asyncio
async def test_opencode_session_error_fails_the_run(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path)
    server = FakeServer(
        [
            _event(
                "session.error",
                sessionID=SESSION,
                error={"name": "ProviderAuthError", "data": {"message": "Sign in to ollama"}},
            ),
            _event("session.status", sessionID=SESSION, status={"type": "idle"}),
        ]
    )
    run_id = run.id

    await opencode_execution_service.execute_run(
        _factory(db_session), run_id, adapter=FakeAdapter(server)
    )

    db_session.expire_all()
    persisted = await db_session.get(AgentRun, run_id)
    assert persisted.status == "failed"
    assert "Sign in to ollama" in persisted.error


@pytest.mark.asyncio
async def test_opencode_run_fails_when_the_workspace_is_not_on_this_machine(
    db_session, tmp_path
):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path / "missing")
    adapter = FakeAdapter(FakeServer([]))
    run_id = run.id

    await opencode_execution_service.execute_run(_factory(db_session), run_id, adapter=adapter)

    db_session.expire_all()
    persisted = await db_session.get(AgentRun, run_id)
    assert persisted.status == "failed"
    assert "does not exist" in persisted.error
    assert adapter.served == []


@pytest.mark.asyncio
async def test_project_default_routes_todo_delegation_to_opencode(
    client, auth_headers, db_session, monkeypatch, tmp_path
):
    project = (
        await client.post(
            "/api/projects",
            headers=auth_headers,
            json={
                "title": "Local repo",
                "default_execution_provider": "opencode",
                "default_execution_model": "ollama/qwen3",
                "execution_workspace_path": str(tmp_path),
            },
        )
    ).json()
    todo = (
        await client.post(
            "/api/todos",
            headers=auth_headers,
            json={"title": "Fix login", "parent_id": project["root_task_id"]},
        )
    ).json()

    launched = []

    async def record_execution(_factory, run_id, **_kwargs):
        launched.append(run_id)

    monkeypatch.setattr(opencode_execution_service, "execute_run", record_execution)
    state_names = ("opencode_adapter", "session_factory")
    previous = {name: getattr(app.state, name) for name in state_names if hasattr(app.state, name)}
    app.state.opencode_adapter = FakeAdapter(FakeServer([]))
    app.state.session_factory = _factory(db_session)
    try:
        delegated = await client.post(
            f"/api/todos/{todo['id']}/delegate",
            headers=auth_headers,
            json={"skill_id": "research"},
        )
        assert delegated.status_code == 200, delegated.text
        run = await db_session.get(AgentRun, delegated.json()["run_id"])
        assert run.provider == "opencode"
        assert run.model == "ollama/qwen3"
        await asyncio.sleep(0)
        assert launched == [run.id]

        # A path that is not on this machine is refused before anything starts.
        await client.patch(
            f"/api/projects/{project['id']}",
            headers=auth_headers,
            json={"execution_workspace_path": str(tmp_path / "elsewhere")},
        )
        other = (
            await client.post(
                "/api/todos",
                headers=auth_headers,
                json={"title": "Fix logout", "parent_id": project["root_task_id"]},
            )
        ).json()
        refused = await client.post(
            f"/api/todos/{other['id']}/delegate",
            headers=auth_headers,
            json={"skill_id": "research"},
        )
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"]["code"] == "EXECUTION_HOST_UNAVAILABLE"
    finally:
        for name in state_names:
            if name in previous:
                setattr(app.state, name, previous[name])
            elif hasattr(app.state, name):
                delattr(app.state, name)


@pytest.mark.asyncio
async def test_execution_provider_endpoint_lists_opencode(client, auth_headers):
    previous = getattr(app.state, "opencode_adapter", None)
    app.state.opencode_adapter = FakeAdapter(FakeServer([]))
    try:
        response = await client.get("/api/execution-providers", headers=auth_headers)
        assert response.status_code == 200, response.text
        opencode = next(item for item in response.json() if item["id"] == "opencode")
        assert opencode["connected"] is True
        tested = await client.post("/api/execution-providers/opencode/test", headers=auth_headers)
        assert tested.json()["id"] == "opencode"
    finally:
        if previous is None:
            delattr(app.state, "opencode_adapter")
        else:
            app.state.opencode_adapter = previous


@pytest.mark.asyncio
async def test_changed_files_waits_for_the_prompt_summary(monkeypatch):
    monkeypatch.setattr(opencode_execution_service, "DIFF_SUMMARY_INTERVAL", 0)
    pending = _messages(diffs=None)
    server = FakeServer([], messages=_messages())
    files = await opencode_execution_service._changed_files(server, SESSION, pending)
    assert files == DIFFS

    # A summary that never arrives falls back to asking for that prompt's diff.
    server = FakeServer([], messages=pending, diff=DIFFS)
    files = await opencode_execution_service._changed_files(server, SESSION, pending)
    assert files == DIFFS
    assert server.diff_requests == ["msg_1"]
