"""ClawChat's own Orca runtime: start, ready, crash and restart, shutdown, reuse."""

import asyncio
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

import pytest

from execution.orca_cli import OrcaAdapter, OrcaError
from execution.orca_runtime import (
    OWNER_FILE,
    SCRATCH_HOME,
    OrcaRuntimeSupervisor,
    live_runtime,
    read_runtime_info,
    socket_answers,
)
from main import app

FAKE_ORCA = Path(__file__).with_name("fake_orca_ide.py")
COMMAND = (sys.executable, str(FAKE_ORCA))


def _supervisor(profile: Path, **overrides) -> OrcaRuntimeSupervisor:
    options = {
        "command": COMMAND,
        "profile": profile,
        "startup_timeout": 10,
        "command_timeout": 10,
        "backoff_initial": 0.05,
        "backoff_max": 0.2,
        "watch_interval": 0.1,
        "stop_timeout": 5,
    }
    options.update(overrides)
    return OrcaRuntimeSupervisor(**options)


def _calls(profile: Path) -> list[dict]:
    path = profile / "fake-calls.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _alive(pid: int | None) -> bool:
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        with open(f"/proc/{pid}/stat") as stat:
            return stat.read().split(")")[-1].split()[0] != "Z"
    except OSError:
        return True


async def _eventually(predicate, timeout: float = 10) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition not reached in time")


@pytest.fixture
def profile(tmp_path):
    path = tmp_path / "orca-profile"
    path.mkdir()
    yield path
    # Nothing a test started may outlive it.
    for call in _calls(path):
        if call["argv"] and call["argv"][0] == "serve" and _alive(call["pid"]):
            os.kill(call["pid"], signal.SIGKILL)
    sockets = path / "fake-socket-dirs"
    for directory in sockets.read_text().splitlines() if sockets.exists() else []:
        shutil.rmtree(directory, ignore_errors=True)


@pytest.mark.asyncio
async def test_starts_orca_in_its_own_profile_once_hooks_are_off(profile):
    supervisor = _supervisor(profile)
    supervisor.start()
    try:
        assert await supervisor.wait_ready(10)
        assert supervisor.state == "running"
        info = await live_runtime(profile)
        assert info is not None and info.pid == supervisor.pid

        calls = _calls(profile)
        commands = [call["argv"][:3] for call in calls]
        assert commands[:3] == [
            ["agent", "hooks", "status"],
            ["agent", "hooks", "off"],
            ["serve", "--port", str(supervisor.bound_port)],
        ]
        # The hooks commands never see the user's home: whatever Orca leaves
        # behind lands in a scratch folder inside the profile.
        assert {call["home"] for call in calls[:2]} == {str(profile / SCRATCH_HOME)}
        serve = calls[2]
        assert serve["home"] == os.environ.get("HOME")
        assert serve["argv"] == [
            "serve", "--port", str(supervisor.bound_port), "--bind", "127.0.0.1", "--no-pairing", "--json",
        ]
        assert serve["telemetry_disabled"] == "1" and serve["do_not_track"] == "1"
        assert supervisor.status()["managed"] is True
    finally:
        await supervisor.stop()


@pytest.mark.asyncio
async def test_hooks_are_only_turned_off_when_still_on(profile):
    (profile / "fake-hooks-off").write_text("off")
    supervisor = _supervisor(profile)
    supervisor.start()
    try:
        assert await supervisor.wait_ready(10)
        assert [call["argv"][:3] for call in _calls(profile)][:2] == [
            ["agent", "hooks", "status"],
            ["serve", "--port", str(supervisor.bound_port)],
        ]
    finally:
        await supervisor.stop()


@pytest.mark.asyncio
async def test_orca_is_never_started_while_its_hooks_stay_on(profile):
    (profile / "fake-hooks-stay-on").write_text("on")
    supervisor = _supervisor(profile)
    supervisor.start()
    try:
        await _eventually(lambda: supervisor.error is not None)
        assert supervisor.state == "restarting"
        assert "hooks" in supervisor.error
        assert not any(call["argv"][0] == "serve" for call in _calls(profile))
    finally:
        await supervisor.stop()


@pytest.mark.asyncio
async def test_a_crashed_runtime_is_started_again(profile):
    (profile / "fake-crash-first").write_text("1")
    supervisor = _supervisor(profile)
    supervisor.start()
    try:
        assert await supervisor.wait_ready(10)
        first = read_runtime_info(profile)
        first_pid = supervisor.pid
        await _eventually(lambda: supervisor.restarts >= 1)
        assert await supervisor.wait_ready(10)
        await _eventually(lambda: supervisor.state == "running" and supervisor.pid != first_pid)
        second = read_runtime_info(profile)
        assert second.runtime_id != first.runtime_id
        assert await socket_answers(second.socket_path)
        assert supervisor.restarts == 1
        assert supervisor.error is None
        # Hooks were settled before the first start and are not asked again.
        assert sum(call["argv"][:3] == ["agent", "hooks", "status"] for call in _calls(profile)) == 1
    finally:
        await supervisor.stop()


@pytest.mark.asyncio
async def test_status_says_why_a_crashed_runtime_is_down(profile):
    (profile / "fake-crash-first").write_text("1")
    supervisor = _supervisor(profile, backoff_initial=30, backoff_max=30)
    supervisor.start()
    try:
        assert await supervisor.wait_ready(10)
        await _eventually(lambda: supervisor.state == "restarting")
        assert "exited with code 1" in supervisor.error
        assert "simulated crash" in supervisor.error
        adapter = OrcaAdapter(
            command=" ".join(COMMAND), user_data_path=str(profile), enabled=True,
            supervisor=supervisor, private_profile=True,
        )
        health = await adapter.health()
        assert health["managed"] is True
        assert health["runtime_state"] == "restarting"
        assert health["connected"] is False
        assert "ClawChat's Orca is not running" in health["error"]
        assert "simulated crash" in health["error"]
    finally:
        await supervisor.stop()


@pytest.mark.asyncio
async def test_shutdown_stops_the_runtime_it_started(profile):
    supervisor = _supervisor(profile)
    supervisor.start()
    assert await supervisor.wait_ready(10)
    pid = supervisor.pid
    info = read_runtime_info(profile)

    await supervisor.stop()

    assert supervisor.state == "stopped"
    assert not _alive(pid)
    assert not await socket_answers(info.socket_path)
    # Orca leaves its metadata behind; it no longer counts as a runtime.
    assert read_runtime_info(profile) is not None
    assert await live_runtime(profile) is None


@pytest.mark.asyncio
async def test_a_stale_runtime_file_is_not_taken_for_a_ready_orca(profile):
    (profile / "orca-runtime.json").write_text(
        json.dumps({"runtimeId": "old", "pid": 1, "transports": [{"kind": "unix", "endpoint": "/nonexistent/o.sock"}]})
    )
    (profile / "fake-never-ready").write_text("1")
    supervisor = _supervisor(profile, startup_timeout=0.5, backoff_initial=30, backoff_max=30)
    supervisor.start()
    try:
        await _eventually(lambda: supervisor.error is not None)
        assert not supervisor.ready
        assert "did not become ready within 0.5s" in supervisor.error
    finally:
        await supervisor.stop()


def _start_external(profile: Path) -> subprocess.Popen:
    env = {**os.environ, "ORCA_USER_DATA_PATH": str(profile)}
    process = subprocess.Popen(
        [*COMMAND, "serve", "--port", "1", "--json"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    return process


@pytest.mark.asyncio
async def test_a_runtime_already_serving_the_profile_is_reused_and_left_running(profile):
    external = _start_external(profile)
    try:
        await _eventually(lambda: read_runtime_info(profile) is not None)
        assert await live_runtime(profile) is not None
        supervisor = _supervisor(profile)
        supervisor.start()
        assert await supervisor.wait_ready(10)
        assert supervisor.state == "reused"
        assert supervisor.pid == external.pid
        assert [call["argv"][0] for call in _calls(profile)] == ["serve"]  # only the external one

        await supervisor.stop()

        assert external.poll() is None
        assert await live_runtime(profile) is not None
    finally:
        external.kill()
        external.wait()


@pytest.mark.asyncio
async def test_when_the_reused_runtime_goes_away_clawchat_starts_its_own(profile):
    external = _start_external(profile)
    supervisor = _supervisor(profile)
    try:
        await _eventually(lambda: read_runtime_info(profile) is not None)
        supervisor.start()
        assert await supervisor.wait_ready(10)
        assert supervisor.state == "reused"

        external.send_signal(signal.SIGTERM)
        external.wait()

        await _eventually(lambda: supervisor.state == "running")
        assert supervisor.pid not in (None, external.pid)
        assert await live_runtime(profile) is not None
    finally:
        await supervisor.stop()
        if external.poll() is None:
            external.kill()
            external.wait()


@pytest.mark.asyncio
async def test_a_runtime_clawchat_started_before_a_crash_is_taken_back(profile):
    first = _supervisor(profile)
    first.start()
    assert await first.wait_ready(10)
    orphan = read_runtime_info(profile)
    # The server dies without stopping Orca: its supervisor goes, Orca stays.
    async def killed_before_it_could_stop_orca():
        return None

    first._terminate = killed_before_it_could_stop_orca
    first._task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await first._task
    assert await socket_answers(orphan.socket_path)
    assert json.loads((profile / OWNER_FILE).read_text())["runtimeId"] == orphan.runtime_id

    second = _supervisor(profile)
    second.start()
    try:
        assert await second.wait_ready(10)
        assert second.state == "running"
        assert second.pid == orphan.pid
    finally:
        await second.stop()
    assert not await socket_answers(orphan.socket_path)
    await _eventually(lambda: not _alive(orphan.pid), timeout=5)


@pytest.mark.asyncio
async def test_a_missing_orca_cli_is_reported_not_retried_blindly(profile):
    supervisor = _supervisor(profile, command="/nonexistent/orca-ide", backoff_initial=30, backoff_max=30)
    supervisor.start()
    try:
        await _eventually(lambda: supervisor.state == "failed")
        assert "Orca CLI executable was not found" in supervisor.error
    finally:
        await supervisor.stop()


# -- the adapter in a private profile -----------------------------------------


@pytest.mark.asyncio
async def test_a_private_profile_keeps_repositories_worktrees_and_trust_inside(tmp_path, monkeypatch):
    requests: list[dict] = []

    async def handle(reader, writer):
        request = json.loads(await reader.readline())
        requests.append(request)
        repo = {"path": "/repo", "worktreeBasePath": request["params"]["updates"]["worktreeBasePath"]}
        writer.write((json.dumps({"id": request["id"], "ok": True, "result": {"repo": repo}}) + "\n").encode())
        await writer.drain()
        writer.close()

    profile = tmp_path / "p"
    profile.mkdir()
    socket_path = tmp_path / "o.sock"
    server = await asyncio.start_unix_server(handle, path=str(socket_path))
    (profile / "orca-runtime.json").write_text(
        json.dumps({"authToken": "t", "transports": [{"kind": "unix", "endpoint": str(socket_path)}]})
    )
    adapter = OrcaAdapter(enabled=True, user_data_path=str(profile), private_profile=True)
    cli_calls = []

    async def fake_cli(*args, timeout=None):
        cli_calls.append(args)
        if args[:2] == ("repo", "show"):
            raise OrcaError("repo_not_found", "no such repo")
        return {}

    monkeypatch.setattr(adapter, "_cli", fake_cli)
    try:
        await adapter.ensure_repo("/repo")
    finally:
        server.close()
        await server.wait_closed()

    assert cli_calls == [("repo", "show", "--repo", "path:/repo"), ("repo", "add", "--path", "/repo")]
    assert requests[0]["method"] == "repo.update"
    assert requests[0]["params"] == {
        "repo": "path:/repo",
        "updates": {"worktreeBasePath": str(profile / "workspaces"), "agentWorkspaceTrust": "agent-asks"},
    }


@pytest.mark.asyncio
async def test_a_profile_clawchat_does_not_own_is_left_as_it_is(tmp_path, monkeypatch):
    adapter = OrcaAdapter(enabled=True, user_data_path=str(tmp_path), private_profile=False)
    rpc_calls = []

    async def fake_cli(*args, timeout=None):
        return {}

    async def fake_rpc(method, params=None, *, timeout=None):
        rpc_calls.append(method)

    monkeypatch.setattr(adapter, "_cli", fake_cli)
    monkeypatch.setattr(adapter, "_rpc", fake_rpc)
    await adapter.ensure_repo("/repo")
    assert rpc_calls == []


@pytest.mark.asyncio
async def test_a_repository_orca_will_not_keep_private_fails_the_run(tmp_path, monkeypatch):
    adapter = OrcaAdapter(enabled=True, user_data_path=str(tmp_path), private_profile=True)

    async def fake_cli(*args, timeout=None):
        return {}

    async def fake_rpc(method, params=None, *, timeout=None):
        raise OrcaError("invalid_argument", "unknown key worktreeBasePath")

    monkeypatch.setattr(adapter, "_cli", fake_cli)
    monkeypatch.setattr(adapter, "_rpc", fake_rpc)
    with pytest.raises(OrcaError) as refused:
        await adapter.ensure_repo("/repo")
    assert refused.value.code == "ORCA_REPO_NOT_PRIVATE"


@pytest.mark.asyncio
async def test_provider_status_says_clawchat_manages_orca_and_why_it_is_down(client, auth_headers, tmp_path):
    supervisor = _supervisor(tmp_path, command="/nonexistent/orca-ide")
    supervisor.state, supervisor.error = "failed", "Orca CLI executable was not found: /nonexistent/orca-ide"
    adapter = OrcaAdapter(
        command=sys.executable, user_data_path=str(tmp_path), enabled=True,
        supervisor=supervisor, private_profile=True,
    )
    previous = getattr(app.state, "orca_adapter", None)
    app.state.orca_adapter = adapter
    try:
        response = await client.get("/api/execution-providers", headers=auth_headers)
    finally:
        app.state.orca_adapter = previous
    assert response.status_code == 200, response.text
    orca = next(item for item in response.json() if item["id"] == "orca")
    assert orca["managed"] is True
    assert orca["runtime_state"] == "failed"
    assert orca["connected"] is False
    assert orca["error"] == "ClawChat's Orca is not running: Orca CLI executable was not found: /nonexistent/orca-ide"
    builtin = next(item for item in response.json() if item["id"] == "builtin")
    assert builtin["managed"] is False and builtin["runtime_state"] is None
