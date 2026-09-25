import asyncio
import json
import sys
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from exceptions import ConflictError
from execution import cli_sessions as cli
from main import app
from schemas.cli_session import CLISessionListResponse


@pytest.mark.parametrize("provider", ["codex", "claude"])
async def test_cli_uses_resolved_executable_without_shell(provider, monkeypatch):
    monkeypatch.setattr(cli, "find_cli", lambda _: sys.executable)
    output = await cli.run_cli(
        provider, "-c", "import sys; print(sys.argv[1])", "literal $(echo injected)"
    )
    assert output.strip() == "literal $(echo injected)"


def thread(status="active"):
    return {
        "id": "thread-1",
        "name": "External task",
        "cwd": "/work",
        "status": {"type": status},
        "turns": [{"id": "turn-1", "status": "inProgress", "items": []}],
    }


def test_saved_codex_sessions_never_claim_live_control():
    row = cli.codex_session(thread(), live=False)
    assert row.status == "unknown"
    assert row.kind == "history"
    assert not row.can_send and not row.can_stop


def test_claude_foreground_is_visible_without_background_controls():
    row = cli.claude_session(
        {
            "sessionId": "session-1",
            "kind": "interactive",
            "status": "waiting",
            "waitingFor": "permission prompt",
        }
    )
    assert row.status == "waiting_input"
    assert row.waiting_for == "permission prompt"
    assert not row.can_stop and not row.can_read and not row.can_restart
    assert row.resume_command == "claude --resume session-1"


def test_claude_background_state_and_short_id():
    row = cli.claude_session(
        {
            "id": "job-1",
            "sessionId": "session-1",
            "kind": "background",
            "state": "stopped",
        }
    )
    assert row.id == "job-1"
    assert row.can_restart and not row.can_stop
    assert row.resume_command == "claude attach job-1"
    assert cli.claude_session({"id": "--all", "kind": "background"}) is None


async def test_provider_failure_does_not_hide_other_sessions(monkeypatch):
    service = cli.CLISessionService()
    monkeypatch.setattr(cli, "find_cli", lambda _: "/bin/cli")
    monkeypatch.setattr(
        service, "codex_sessions", AsyncMock(side_effect=RuntimeError("offline"))
    )
    row = cli.claude_session(
        {"sessionId": "c-1", "kind": "interactive", "status": "busy"}
    )
    monkeypatch.setattr(
        service,
        "claude_sessions",
        AsyncMock(
            return_value=(
                [row],
                cli.CLIProviderState(provider="claude", connected=True),
            )
        ),
    )
    result = await service.list()
    assert [s.id for s in result.sessions] == ["c-1"]
    assert not result.providers[0].connected


async def test_cancellation_is_not_converted_to_disconnected(monkeypatch):
    service = cli.CLISessionService()
    monkeypatch.setattr(cli, "find_cli", lambda _: "/bin/cli")
    monkeypatch.setattr(
        service, "codex_sessions", AsyncMock(side_effect=asyncio.CancelledError)
    )
    monkeypatch.setattr(
        service,
        "claude_sessions",
        AsyncMock(
            return_value=([], cli.CLIProviderState(provider="claude", connected=True))
        ),
    )
    with pytest.raises(asyncio.CancelledError):
        await service.list()


async def test_claude_controls_revalidate_session_and_use_argv(monkeypatch):
    runner = AsyncMock(
        return_value='[{"id":"job-1","kind":"background","state":"working"}]'
    )
    monkeypatch.setattr(cli, "run_cli", runner)
    service = cli.CLISessionService()
    await service.act("claude", "job-1", "stop")
    assert runner.call_args.args == ("claude", "stop", "job-1")
    runner.return_value = '[{"sessionId":"job-1","kind":"interactive","status":"busy"}]'
    with pytest.raises(ConflictError):
        await service.act("claude", "job-1", "stop")
    assert runner.call_args.args == ("claude", "agents", "--json", "--all")


async def test_codex_control_targets_existing_active_turn(monkeypatch):
    connection = AsyncMock()
    connection.call.side_effect = [{"thread": thread()}, {}]

    @asynccontextmanager
    async def connect(*, require_live=False):
        assert require_live
        yield connection

    monkeypatch.setattr(cli, "codex_connection", connect)
    await cli.CLISessionService().act(
        "codex", "thread-1", "message", "  continue tests  "
    )
    assert connection.call.call_args.args == (
        "turn/steer",
        {
            "threadId": "thread-1",
            "expectedTurnId": "turn-1",
            "input": [{"type": "text", "text": "continue tests"}],
        },
    )


async def test_codex_rejects_stale_action_after_turn_finishes(monkeypatch):
    connection = AsyncMock()
    connection.call.return_value = {"thread": thread("idle")}

    @asynccontextmanager
    async def connect(**kwargs):
        yield connection

    monkeypatch.setattr(cli, "codex_connection", connect)
    with pytest.raises(ConflictError):
        await cli.CLISessionService().act("codex", "thread-1", "stop")
    assert connection.call.await_count == 1


async def test_session_endpoints_require_auth(client):
    assert (await client.get("/api/cli-sessions")).status_code == 401
    assert (
        await client.post(
            "/api/cli-sessions/claude/job-1/actions", json={"action": "stop"}
        )
    ).status_code == 401


async def test_api_lists_and_rejects_invalid_controls(
    client, auth_headers, monkeypatch
):
    service = AsyncMock()
    service.list.return_value = CLISessionListResponse(sessions=[], providers=[])
    monkeypatch.setattr(app.state, "cli_session_service", service, raising=False)
    assert (await client.get("/api/cli-sessions", headers=auth_headers)).json() == {
        "sessions": [],
        "providers": [],
    }
    for provider, session_id, body in [
        ("other", "job-1", {"action": "stop"}),
        ("claude", "--all", {"action": "stop"}),
        ("codex", "thread-1", {"action": "message", "message": " "}),
        ("claude", "job-1", {"action": "delete"}),
    ]:
        response = await client.post(
            f"/api/cli-sessions/{provider}/{session_id}/actions",
            headers=auth_headers,
            json=body,
        )
        assert response.status_code == 422
    service.act.assert_not_called()


async def test_disabled_sessions_do_not_access_host(client, auth_headers, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "cli_sessions_enabled", False)
    assert (
        await client.get("/api/cli-sessions", headers=auth_headers)
    ).status_code == 403


async def test_live_socket_discovers_old_loaded_session_and_interrupts_exact_turn(
    tmp_path, monkeypatch
):
    from websockets.asyncio.server import unix_serve
    from config import settings

    socket = tmp_path / "codex.sock"
    monkeypatch.setattr(settings, "cli_sessions_codex_socket", str(socket))
    requests = []

    async def handler(ws):
        async for raw in ws:
            request = json.loads(raw)
            requests.append(request)
            if "id" not in request:
                continue
            result = {
                "initialize": {},
                "thread/loaded/list": {"data": ["thread-1"]},
                "thread/list": {"data": []},
                "thread/read": {"thread": thread()},
                "turn/interrupt": {},
            }[request["method"]]
            await ws.send(json.dumps({"method": "thread/status/changed", "params": {}}))
            await ws.send(json.dumps({"id": request["id"], "result": result}))

    async with unix_serve(handler, str(socket)):
        service = cli.CLISessionService()
        sessions, provider = await service.codex_sessions()
        assert provider.connected
        assert len(sessions) == 1 and sessions[0].can_stop
        await service.act("codex", "thread-1", "stop")

    controls = [r for r in requests if r["method"] == "turn/interrupt"]
    assert [r["params"] for r in controls] == [
        {"threadId": "thread-1", "turnId": "turn-1"}
    ]
    assert not any(r["method"] in ("thread/start", "thread/resume") for r in requests)


async def test_control_never_starts_a_history_server_when_daemon_is_missing(
    tmp_path, monkeypatch
):
    from config import settings

    monkeypatch.setattr(
        settings, "cli_sessions_codex_socket", str(tmp_path / "missing.sock")
    )
    spawn = AsyncMock()
    monkeypatch.setattr(cli.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(ConflictError):
        async with cli.codex_connection(require_live=True):
            pytest.fail("No live daemon exists")
    spawn.assert_not_called()
