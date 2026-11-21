"""Orca adapter contract and AgentRun integration coverage."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from config import settings
from domain.review import ReviewStatus
from execution.orca_cli import (
    OrcaAdapter,
    OrcaChatState,
    OrcaError,
    OrcaRequest,
    OrcaTranscript,
    OrcaWorktree,
    envelope,
)
from main import app
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, orca_execution_service

SESSION = "15573425-772a-4b44-bb1d-ee143acdb074"
APPROVAL = OrcaRequest(
    item_id="orca:codex-prompt%3Aexec-1",
    revision=1,
    kind="approval",
    title="Run a command?",
    detail="/bin/bash -lc 'echo spike > /home/u/outside.txt'",
    options=({"id": "accept", "label": "Allow", "intent": "allow_once"}, {"id": "cancel", "label": "Stop"}),
)


class FakeOrcaAdapter:
    enabled = True
    host_label = "local"

    def __init__(self, states=("working", "done"), *, requests=(), reply="Fixed add(); tests pass."):
        self.states = list(states)
        self.requests = list(requests)
        self.reply = reply
        self.calls: list[str] = []
        self.prompts: list[str] = []
        self.ensure_repo = AsyncMock()
        self.create_worktree = AsyncMock(
            return_value=OrcaWorktree(
                id="repo-1::/orca/workspaces/repo/clawchat-1",
                path="/orca/workspaces/repo/clawchat-1",
                branch="refs/heads/clawchat/fix-add",
            )
        )
        self.launch_chat = AsyncMock(return_value=SESSION)
        self.cancel = AsyncMock()
        self.respond = AsyncMock()

    async def set_permission_mode(self, session_id, mode):
        self.calls.append(f"mode:{mode}")

    async def send(self, session_id, text):
        self.calls.append("send")
        self.prompts.append(text)

    async def chat_state(self, session_id):
        state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
        return OrcaChatState(session_id=session_id, state=state, last_message=None, updated_at_ms=1)

    async def transcript(self, session_id, *, limit=30):
        entries = []
        if self.prompts:
            entries.append({"kind": "message", "role": "user", "text": self.prompts[-1]})
        if self.reply and self.states[0] != "working":
            entries.append({"kind": "message", "role": "assistant", "text": self.reply})
        return OrcaTranscript(state=None, entries=tuple(entries))

    async def pending_requests(self, session_id):
        return list(self.requests)

    async def changed_files(self, path):
        return [{"path": "calc.py", "status": "modified", "area": "unstaged", "added": 1, "removed": 1}]

    async def file_diff(self, path, file_path, *, staged):
        return {
            "kind": "text",
            "originalContent": "def add(a, b):\n    return a - b\n",
            "modifiedContent": "def add(a, b):\n    return a + b\n",
        }

    async def list_repos(self):
        return [{"path": "/repos/clawchat", "name": "clawchat"}]

    async def health(self):
        return {
            "enabled": True,
            "available": True,
            "connected": True,
            "host": "local",
            "error": None,
            "providers": [{"provider": "codex", "label": "Codex"}],
        }


async def _project_run(db_session, workspace: Path, *, isolation="worktree", status="queued", session=None):
    project = Project(
        id="project_orca",
        title="Orca project",
        default_execution_provider="orca",
        execution_workspace_path=str(workspace),
        execution_workspace_isolation=isolation,
        execution_base_branch="main",
    )
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_orca", project_id=project.id, title="Fix add")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_orca",
        task_type="delegate_general",
        instruction="Fix add() in calc.py",
        todo_id=todo.id,
        agent_type="general",
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(db_session, task, provider="orca", model=None)
    run.status = status
    if session:
        run.external_run_id = session
        run.workspace_id = "/orca/workspaces/repo/clawchat-1"
        run.usage_json = json.dumps(
            {
                "session_id": session,
                "prompt_sent": True,
                "prompt_head": run.instruction_snapshot[:120],
                "turn_seen": True,
                "pending_requests": [{"id": APPROVAL.item_id, "tool": APPROVAL.title}],
            }
        )
    await db_session.commit()
    return project, todo, task, run


def _factory(db_session):
    return async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)


async def _events(db_session, run_id):
    return list(
        (
            await db_session.execute(
                select(AgentRunEvent).where(AgentRunEvent.run_id == run_id).order_by(AgentRunEvent.sequence)
            )
        ).scalars()
    )


class _AppState:
    """Swap app.state attributes for one test and put them back."""

    def __init__(self, **values):
        self.values = values
        self.previous = {}

    def __enter__(self):
        for name, value in self.values.items():
            if hasattr(app.state, name):
                self.previous[name] = getattr(app.state, name)
            setattr(app.state, name, value)

    def __exit__(self, *_exc):
        for name in self.values:
            if name in self.previous:
                setattr(app.state, name, self.previous[name])
            elif hasattr(app.state, name):
                delattr(app.state, name)


# -- the adapter's contract with Orca ------------------------------------


def test_write_fingerprints_match_what_orca_accepted():
    # Both digests were accepted by orca-ide 1.4.267 during the spike.
    mode = envelope(
        "agentSession.setOption", SESSION, {"key": "permissionMode", "value": "ask"}
    )
    assert mode["payloadFingerprint"] == (
        "5a244d37538b8cea87c49c266bc1fea0711423345e5d9ae1cb5a72b2236b8c98"
    )
    text = "Now add a subtract(a, b) function to calc.py that returns a - b. Do not commit."
    body = {"kind": "message", "role": "user", "blocks": [{"type": "text", "text": text}]}
    sent = envelope("agentSession.send", SESSION, {"body": body})
    assert sent["payloadFingerprint"] == (
        "05304921898e468d8371f5b9ab9ddebdb29dfe0fae5ec20aee02bc9a35a382bf"
    )
    assert sent["expectedRuntimeFence"] is None
    assert sent["clientOperationId"] != mode["clientOperationId"]


def test_request_picks_allow_and_deny_options():
    assert APPROVAL.option_for(allow=True) == "accept"
    assert APPROVAL.option_for(allow=False) == "cancel"
    declinable = OrcaRequest(
        item_id="x",
        revision=2,
        kind="approval",
        title="Apply patch?",
        detail="",
        options=({"id": "yes", "intent": "allow_session"}, {"id": "decline"}, {"id": "cancel"}),
    )
    assert declinable.option_for(allow=True) == "yes"
    assert declinable.option_for(allow=False) == "decline"


def test_reply_is_the_last_answer_after_the_latest_prompt():
    transcript = OrcaTranscript(
        state="done",
        entries=(
            {"kind": "message", "role": "user", "text": "first"},
            {"kind": "message", "role": "assistant", "text": "old answer"},
            {"kind": "message", "role": "user", "text": "second"},
            {"kind": "tool", "name": "read", "state": "completed"},
            {"kind": "message", "role": "assistant", "text": "Looking."},
            {"kind": "message", "role": "assistant", "text": "Done: fixed."},
        ),
    )
    assert transcript.reply_after_last_prompt() == "Done: fixed."
    waiting = OrcaTranscript(state="done", entries=transcript.entries[:3])
    assert waiting.reply_after_last_prompt() is None


@pytest.mark.asyncio
async def test_adapter_refuses_full_access_before_calling_orca(tmp_path):
    adapter = OrcaAdapter(enabled=True, user_data_path=str(tmp_path))
    with pytest.raises(OrcaError) as refused:
        await adapter.set_permission_mode(SESSION, "full-access")
    assert refused.value.code == "ORCA_PERMISSION_MODE_REFUSED"


@pytest.mark.asyncio
async def test_adapter_speaks_orca_socket_protocol(tmp_path):
    requests: list[dict] = []
    pending = [
        {
            "itemId": APPROVAL.item_id,
            "revision": 1,
            "body": {
                "kind": "approval",
                "title": APPROVAL.title,
                "detail": APPROVAL.detail,
                "options": list(APPROVAL.options),
                "resolution": {"state": "pending"},
            },
        },
        {
            "itemId": "resolved-one",
            "revision": 2,
            "body": {"kind": "approval", "title": "Old", "resolution": {"state": "resolved"}},
        },
    ]

    async def handle(reader, writer):
        request = json.loads(await reader.readline())
        requests.append(request)
        params = request.get("params") or {}
        if request["method"] == "agentSession.currentRequests":
            if params["version"] != "v1":
                result = {"marker": {"version": "v1"}, "json": "", "nextCursor": 0, "restart": True}
            elif params.get("cursor", 0) == 0:
                text = json.dumps(pending)
                result = {"marker": {"version": "v1"}, "json": text, "nextCursor": len(text)}
            else:
                result = {"marker": {"version": "v1"}, "json": "", "nextCursor": params["cursor"]}
        else:
            result = {"ok": True, "value": {}}
        writer.write((json.dumps({"id": request["id"], "ok": True, "result": result}) + "\n").encode())
        await writer.drain()
        writer.close()

    socket_path = tmp_path / "o.sock"
    server = await asyncio.start_unix_server(handle, path=str(socket_path))
    (tmp_path / "orca-runtime.json").write_text(
        json.dumps({"authToken": "secret-token", "transports": [{"kind": "unix", "endpoint": str(socket_path)}]})
    )
    try:
        adapter = OrcaAdapter(enabled=True, user_data_path=str(tmp_path))
        found = await adapter.pending_requests(SESSION)
        assert [request.item_id for request in found] == [APPROVAL.item_id]
        await adapter.respond(SESSION, found[0], allow=False)
    finally:
        server.close()
        await server.wait_closed()

    assert all(request["authToken"] == "secret-token" for request in requests)
    answer = requests[-1]
    assert answer["method"] == "agentSession.respondToApproval"
    assert answer["params"]["optionId"] == "cancel"
    expected = envelope(
        "agentSession.respondTo:approval",
        SESSION,
        {"itemId": APPROVAL.item_id, "expectedRevision": 1, "optionId": "cancel"},
    )
    assert answer["params"]["envelope"]["payloadFingerprint"] == expected["payloadFingerprint"]


@pytest.mark.asyncio
async def test_cli_errors_keep_orca_codes(monkeypatch):
    captured = []

    class Process:
        returncode = 1

        async def communicate(self):
            return (
                b'{"id":"local","ok":false,"error":{"code":"no_active_sender_terminal","message":"Pass --from"}}',
                b"",
            )

        def kill(self):
            return None

    async def create_process(*argv, **kwargs):
        captured.append((argv, kwargs))
        return Process()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    adapter = OrcaAdapter(command="/bin/echo", enabled=True, user_data_path="/profiles/orca")
    with pytest.raises(OrcaError) as failed:
        await adapter.launch_chat(worktree_path="/repo; rm -rf /", agent="codex", model=None)
    assert failed.value.code == "no_active_sender_terminal"
    argv, kwargs = captured[0]
    assert "path:/repo; rm -rf /" in argv
    assert argv[-1] == "--json"
    assert kwargs["env"]["ORCA_USER_DATA_PATH"] == "/profiles/orca"
    assert kwargs["env"]["ORCA_TELEMETRY_DISABLED"] == "1"


# -- runs ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_orca_run_reaches_review_with_its_diff(db_session, tmp_path):
    project, _todo, _task, run = await _project_run(db_session, tmp_path)
    run_id, project_id = run.id, project.id
    adapter = FakeOrcaAdapter()

    await orca_execution_service.execute_run(
        _factory(db_session), run_id, adapter=adapter, poll_interval=0.001, reconnect_grace_seconds=0.1
    )

    db_session.expire_all()
    persisted = await db_session.get(AgentRun, run_id)
    assert persisted.status == "waiting_review", persisted.error
    assert persisted.external_run_id == SESSION
    assert persisted.workspace_id == "/orca/workspaces/repo/clawchat-1"
    assert "Fixed add()" in persisted.result
    assert "calc.py (+1 -1)" in persisted.result
    adapter.ensure_repo.assert_awaited_once_with(str(tmp_path))
    created = adapter.create_worktree.await_args.kwargs
    assert created["repo_path"] == str(tmp_path)
    assert created["base_branch"] == "main"
    assert created["branch"].startswith("clawchat/fix-add-")
    launched = adapter.launch_chat.await_args.kwargs
    assert launched["agent"] == settings.orca_agent
    assert launched["model"] == orca_execution_service.default_model(settings.orca_agent)
    # The mode is set before anything reaches the agent.
    assert adapter.calls == [f"mode:{settings.orca_permission_mode}", "send"]
    assert adapter.prompts == [persisted.instruction_snapshot]
    metadata = json.loads(persisted.usage_json)
    assert "+    return a + b" in metadata["patch"]

    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.APPROVED)
    await db_session.commit()
    code_diff = (
        await db_session.execute(
            select(Artifact).where(Artifact.created_by == run_id, Artifact.type == "code_diff")
        )
    ).scalar_one()
    assert code_diff.project_id == project_id
    assert code_diff.source == "orca"
    assert "-    return a - b" in code_diff.content
    kinds = {event.event_type for event in await _events(db_session, run_id)}
    assert {"workspace_created", "provider_started", "provider_running"} <= kinds


@pytest.mark.asyncio
async def test_local_isolation_runs_in_the_project_folder(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path, isolation="local")
    adapter = FakeOrcaAdapter()

    await orca_execution_service.execute_run(_factory(db_session), run.id, adapter=adapter, poll_interval=0.001)

    adapter.create_worktree.assert_not_awaited()
    assert adapter.launch_chat.await_args.kwargs["worktree_path"] == str(tmp_path)


@pytest.mark.asyncio
async def test_a_settled_chat_is_not_finished_before_it_answers_the_prompt(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path)
    run_id = run.id
    adapter = FakeOrcaAdapter(states=("done", "done", "working", "done"))
    # Before the agent picks the prompt up, the transcript ends at the prompt.
    real_transcript = adapter.transcript
    seen = []

    async def transcript(session_id, *, limit=30):
        seen.append(adapter.states[0])
        if len(seen) <= 2:
            return OrcaTranscript(
                state=None, entries=({"kind": "message", "role": "user", "text": adapter.prompts[-1]},)
            )
        return await real_transcript(session_id, limit=limit)

    adapter.transcript = transcript
    await orca_execution_service.execute_run(_factory(db_session), run_id, adapter=adapter, poll_interval=0.001)

    db_session.expire_all()
    persisted = await db_session.get(AgentRun, run_id)
    assert persisted.status == "waiting_review"
    assert "Fixed add()" in persisted.result
    assert len(seen) >= 3


@pytest.mark.asyncio
async def test_an_approval_waits_for_the_person_and_allow_answers_it_in_orca(
    client, auth_headers, db_session, tmp_path, monkeypatch
):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path)
    run_id = run.id
    adapter = FakeOrcaAdapter(states=("working", "blocked"), requests=[APPROVAL])

    await orca_execution_service.execute_run(_factory(db_session), run_id, adapter=adapter, poll_interval=0.001)

    db_session.expire_all()
    waiting = await db_session.get(AgentRun, run_id)
    assert waiting.status == "waiting_input"
    event = (await _events(db_session, run_id))[-1]
    assert event.event_type == "waiting_permission"
    assert json.loads(event.payload_json)["permissions"][0]["id"] == APPROVAL.item_id

    relaunched = []

    async def record_execution(_factory, run_id, **_kwargs):
        relaunched.append(run_id)

    monkeypatch.setattr(orca_execution_service, "execute_run", record_execution)
    with _AppState(orca_adapter=adapter, session_factory=_factory(db_session)):
        response = await client.post(
            f"/api/runs/{run_id}/permission", headers=auth_headers, json={"decision": "allow"}
        )
        await asyncio.sleep(0)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "running"
    adapter.respond.assert_awaited_once_with(SESSION, APPROVAL, allow=True)
    assert relaunched == [run_id]
    assert (await _events(db_session, run_id))[-1].event_type == "permission_allowed"


@pytest.mark.asyncio
async def test_permission_never_answers_a_request_nobody_was_shown(
    client, auth_headers, db_session, tmp_path
):
    _project, _todo, _task, run = await _project_run(
        db_session, tmp_path, status="waiting_input", session=SESSION
    )
    newer = OrcaRequest(
        item_id="orca:codex-prompt%3Aexec-2",
        revision=1,
        kind="approval",
        title="Delete files?",
        detail="rm -rf build",
        options=APPROVAL.options,
    )
    adapter = FakeOrcaAdapter(requests=[newer])
    with _AppState(orca_adapter=adapter, session_factory=_factory(db_session)):
        response = await client.post(
            f"/api/runs/{run.id}/permission", headers=auth_headers, json={"decision": "allow"}
        )
    assert response.status_code == 409, response.text
    adapter.respond.assert_not_awaited()


@pytest.mark.asyncio
async def test_follow_up_declines_the_pending_request_and_reuses_the_chat(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(
        db_session, tmp_path, status="waiting_input", session=SESSION
    )
    run_id = run.id
    adapter = FakeOrcaAdapter(states=("working", "done"), requests=[APPROVAL])

    await orca_execution_service.resume_external_run(
        _factory(db_session), run_id, "Skip that command and only edit calc.py", adapter=adapter
    )

    db_session.expire_all()
    completed = await db_session.get(AgentRun, run_id)
    assert completed.status == "waiting_review", completed.error
    adapter.respond.assert_awaited_once_with(SESSION, APPROVAL, allow=False)
    assert adapter.prompts == ["Skip that command and only edit calc.py"]
    adapter.launch_chat.assert_not_awaited()
    adapter.create_worktree.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_follow_up_orca_cannot_take_fails_the_run_instead_of_hanging(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(
        db_session, tmp_path, status="waiting_input", session=SESSION
    )
    run_id = run.id
    adapter = FakeOrcaAdapter()

    async def down(*_args, **_kwargs):
        raise OrcaError("ORCA_NOT_RUNNING", "Orca is not running")

    adapter.pending_requests = down
    await orca_execution_service.resume_external_run(
        _factory(db_session), run_id, "Try again", adapter=adapter
    )
    db_session.expire_all()
    failed = await db_session.get(AgentRun, run_id)
    assert failed.status == "failed"
    assert "Could not send the follow-up" in failed.error


@pytest.mark.asyncio
async def test_permission_answer_reports_an_unreachable_orca(client, auth_headers, db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(
        db_session, tmp_path, status="waiting_input", session=SESSION
    )
    adapter = FakeOrcaAdapter()

    async def down(*_args, **_kwargs):
        raise OrcaError("ORCA_NOT_RUNNING", "Orca is not running")

    adapter.pending_requests = down
    with _AppState(orca_adapter=adapter, session_factory=_factory(db_session)):
        response = await client.post(
            f"/api/runs/{run.id}/permission", headers=auth_headers, json={"decision": "deny"}
        )
    assert response.status_code == 409, response.text
    assert "Orca is not running" in response.json()["error"]["message"]


@pytest.mark.asyncio
async def test_cancel_endpoint_stops_the_orca_turn(client, auth_headers, db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path, status="running", session=SESSION)
    adapter = FakeOrcaAdapter()
    with _AppState(orca_adapter=adapter):
        response = await client.post(f"/api/runs/{run.id}/cancel", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    adapter.cancel.assert_awaited_once_with(SESSION)


@pytest.mark.asyncio
async def test_restart_keeps_an_orca_run_for_reattachment(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path, status="running", session=SESSION)
    reconciled = await agent_run_service.reconcile_interrupted_runs(db_session)
    await db_session.commit()
    await db_session.refresh(run)
    assert reconciled == 0
    assert run.status == "running"


@pytest.mark.asyncio
async def test_an_unreachable_orca_fails_the_run_after_the_grace_period(db_session, tmp_path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path, status="running", session=SESSION)
    run_id = run.id
    adapter = FakeOrcaAdapter()

    async def unreachable(_session_id):
        raise OrcaError("ORCA_NOT_RUNNING", "Orca is not running")

    adapter.chat_state = unreachable
    await orca_execution_service.execute_run(
        _factory(db_session), run_id, adapter=adapter, poll_interval=0.001, reconnect_grace_seconds=0.003
    )
    db_session.expire_all()
    failed = await db_session.get(AgentRun, run_id)
    assert failed.status == "failed"
    assert "unreachable" in failed.error
    assert "provider_disconnected" in {event.event_type for event in await _events(db_session, run_id)}


@pytest.mark.asyncio
async def test_project_default_routes_delegation_to_orca(client, auth_headers, db_session, monkeypatch, tmp_path):
    project = (
        await client.post(
            "/api/projects",
            headers=auth_headers,
            json={
                "title": "Orca repo",
                "default_execution_provider": "orca",
                "execution_workspace_path": str(tmp_path),
                "execution_workspace_isolation": "worktree",
            },
        )
    ).json()
    todo = (
        await client.post(
            "/api/todos", headers=auth_headers, json={"title": "Fix login", "parent_id": project["root_task_id"]}
        )
    ).json()
    launched = []

    async def record_execution(_factory, run_id, **_kwargs):
        launched.append(run_id)

    monkeypatch.setattr(orca_execution_service, "execute_run", record_execution)
    with _AppState(orca_adapter=FakeOrcaAdapter(), session_factory=_factory(db_session)):
        delegated = await client.post(
            f"/api/todos/{todo['id']}/delegate", headers=auth_headers, json={"skill_id": "research"}
        )
        await asyncio.sleep(0)
    assert delegated.status_code == 200, delegated.text
    run = await db_session.get(AgentRun, delegated.json()["run_id"])
    assert run.provider == "orca"
    assert run.model == orca_execution_service.default_model(settings.orca_agent)
    # The skill text travels in the instruction, as for every CLI backend.
    assert "[Skill: research]" in run.instruction_snapshot
    assert launched == [run.id]


@pytest.mark.asyncio
async def test_delegation_to_a_disabled_orca_is_refused(client, auth_headers, db_session, tmp_path):
    project = (
        await client.post(
            "/api/projects",
            headers=auth_headers,
            json={"title": "Orca repo", "default_execution_provider": "orca", "execution_workspace_path": str(tmp_path)},
        )
    ).json()
    todo = (
        await client.post(
            "/api/todos", headers=auth_headers, json={"title": "Fix login", "parent_id": project["root_task_id"]}
        )
    ).json()
    disabled = FakeOrcaAdapter()
    disabled.enabled = False
    with _AppState(orca_adapter=disabled, session_factory=_factory(db_session)):
        refused = await client.post(
            f"/api/todos/{todo['id']}/delegate", headers=auth_headers, json={"skill_id": "research"}
        )
    assert refused.status_code == 503, refused.text
    assert refused.json()["error"]["code"] == "ORCA_DISABLED"


@pytest.mark.asyncio
async def test_execution_provider_endpoint_lists_orca(client, auth_headers):
    with _AppState(orca_adapter=FakeOrcaAdapter()):
        response = await client.get("/api/execution-providers", headers=auth_headers)
    assert response.status_code == 200, response.text
    orca = next(item for item in response.json() if item["id"] == "orca")
    assert orca["connected"] is True
    assert orca["providers"][0]["provider"] == "codex"
    assert orca["permission_mode"] == settings.orca_permission_mode


# -- after review ------------------------------------------------------------


def _git_repo(path: Path) -> Path:
    import subprocess

    path.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True)
    (path / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@e.invalid", "commit", "-qm", "init"],
        check=True,
    )
    return path


async def _reviewed_run(db_session, tmp_path, worktree: Path):
    _project, _todo, _task, run = await _project_run(db_session, tmp_path)
    run_id = run.id
    adapter = FakeOrcaAdapter()
    adapter.create_worktree = AsyncMock(
        return_value=OrcaWorktree(id="repo-1::wt", path=str(worktree), branch="refs/heads/clawchat/fix-add-1")
    )
    await orca_execution_service.execute_run(_factory(db_session), run_id, adapter=adapter, poll_interval=0.001)
    db_session.expire_all()
    assert (await db_session.get(AgentRun, run_id)).status == "waiting_review"
    return run_id


@pytest.mark.asyncio
async def test_approving_commits_the_worktree_on_its_branch(db_session, tmp_path):
    import subprocess

    worktree = _git_repo(tmp_path / "wt")
    run_id = await _reviewed_run(db_session, tmp_path, worktree)
    (worktree / "calc.py").write_text("def add(a, b):\n    return a + b\n")

    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.APPROVED)
    await db_session.commit()

    head = subprocess.run(
        ["git", "-C", str(worktree), "log", "-1", "--format=%s"], capture_output=True, text=True, check=True
    ).stdout.strip()
    assert head == "Fix add"
    clean = subprocess.run(
        ["git", "-C", str(worktree), "status", "--porcelain"], capture_output=True, text=True, check=True
    ).stdout
    assert clean == ""
    committed = (await _events(db_session, run_id))
    event = next(e for e in committed if e.event_type == "changes_committed")
    assert "clawchat/fix-add-1" in event.message


@pytest.mark.asyncio
async def test_rejecting_removes_the_worktree_and_its_branch(db_session, tmp_path, monkeypatch):
    worktree = _git_repo(tmp_path / "wt")
    run_id = await _reviewed_run(db_session, tmp_path, worktree)
    remover = FakeOrcaAdapter()
    remover.remove_worktree = AsyncMock()
    monkeypatch.setattr(orca_execution_service, "adapter_from_settings", lambda: remover)

    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.REJECTED)
    await db_session.commit()

    remover.remove_worktree.assert_awaited_once_with(str(worktree), delete_branch=True)
    assert "workspace_removed" in {e.event_type for e in await _events(db_session, run_id)}


@pytest.mark.asyncio
async def test_the_project_folder_itself_is_never_committed_or_removed(db_session, tmp_path, monkeypatch):
    folder = _git_repo(tmp_path / "project")
    _project, _todo, _task, run = await _project_run(db_session, folder, isolation="local")
    run_id = run.id
    await orca_execution_service.execute_run(
        _factory(db_session), run_id, adapter=FakeOrcaAdapter(), poll_interval=0.001
    )
    db_session.expire_all()
    (folder / "calc.py").write_text("changed\n")
    remover = FakeOrcaAdapter()
    remover.remove_worktree = AsyncMock()
    monkeypatch.setattr(orca_execution_service, "adapter_from_settings", lambda: remover)

    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.REJECTED)
    await db_session.commit()

    remover.remove_worktree.assert_not_awaited()
    assert (folder / "calc.py").read_text() == "changed\n"


# -- picking a repository ----------------------------------------------------


@pytest.mark.asyncio
async def test_orca_repositories_are_listed_for_the_picker(client, auth_headers):
    with _AppState(orca_adapter=FakeOrcaAdapter()):
        response = await client.get("/api/execution-providers/orca/repositories", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json() == [{"path": "/repos/clawchat", "name": "clawchat"}]


@pytest.mark.asyncio
async def test_choosing_an_orca_repository_sets_up_the_project_in_one_step(
    client, auth_headers, db_session, tmp_path
):
    project = (
        await client.post("/api/projects", headers=auth_headers, json={"title": "Repo work"})
    ).json()

    response = await client.put(
        f"/api/projects/{project['id']}/workspace/orca", headers=auth_headers, json={"path": str(tmp_path)}
    )

    assert response.status_code == 200, response.text
    workspace = response.json()
    assert workspace["path"] == str(tmp_path)
    assert workspace["is_unconfigured"] is False
    db_session.expire_all()
    saved = await db_session.get(Project, project["id"])
    assert saved.default_execution_provider == "orca"
    assert saved.execution_workspace_path == str(tmp_path)
    resolution = await orca_execution_service.execution_host_service.resolve_workspace(db_session, saved)
    assert orca_execution_service.workspace_problem(resolution) is None

    missing = await client.put(
        f"/api/projects/{project['id']}/workspace/orca",
        headers=auth_headers,
        json={"path": str(tmp_path / "nope")},
    )
    assert missing.status_code in (400, 422), missing.text
