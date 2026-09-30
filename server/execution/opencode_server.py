"""A private, sandboxed ``opencode serve`` for one agent run.

OpenCode's own permission rules are not a boundary: ``external_directory``
stops its file tools and a ``cd ..``, but an approved shell command writes
wherever its redirect points. So on Linux the server runs under bubblewrap
with the whole filesystem read-only, and only the project's path and
OpenCode's own state directories writable -- the reach is decided here, not
by the model, as ``codex --sandbox workspace-write`` does for Codex runs.

Each server listens on loopback behind a password that exists only for its
lifetime, and ClawChat's configuration arrives through the environment, so a
repository's own ``opencode.json`` can add skills and agents but cannot loosen
what ClawChat pinned.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
from collections import deque
from collections.abc import AsyncIterator, Mapping
from concurrent.futures import Future
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SANDBOXES = ("bwrap", "none")
SERVER_USERNAME = "opencode"
_LISTENING = re.compile(r"listening on (http://\S+)")

#: Every permission a delegated run could ask for, answered up front. Nobody
#: is watching the run, and a prompt nobody answers is a run that hangs.
#: A rule of "deny" fails that one call and the agent carries on.
RUN_PERMISSIONS: dict[str, str] = {
    "read": "allow",
    "edit": "allow",
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "bash": "allow",
    "task": "allow",
    "todowrite": "allow",
    "lsp": "allow",
    "skill": "allow",
    "webfetch": "allow",
    # A third-party search service; ClawChat offers its own web search as a
    # tool when the workspace has one configured.
    "websearch": "deny",
    "question": "deny",
    "doom_loop": "deny",
    "external_directory": "deny",
}


class OpenCodeError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def find_executable(command: str) -> str | None:
    """Find OpenCode even when a packaged app runs with a minimal PATH."""
    if os.sep in command or (os.altsep and os.altsep in command):
        return command if os.path.isfile(command) else None
    found = shutil.which(command)
    if found:
        return found
    home = Path.home()
    for directory in (
        home / ".opencode" / "bin",
        home / ".local" / "bin",
        home / ".bun" / "bin",
        home / ".npm-global" / "bin",
        Path("/usr/local/bin"),
        Path("/opt/homebrew/bin"),
    ):
        candidate = directory / command
        if candidate.is_file():
            return str(candidate)
    return None


def state_dirs(env: Mapping[str, str], home: Path) -> list[Path]:
    """Where OpenCode keeps sessions, logs and caches."""
    return [
        Path(env.get("XDG_DATA_HOME") or home / ".local" / "share") / "opencode",
        Path(env.get("XDG_STATE_HOME") or home / ".local" / "state") / "opencode",
        Path(env.get("XDG_CACHE_HOME") or home / ".cache") / "opencode",
    ]


def _install_root(executable: str) -> Path:
    """The directory an install lives in; an npm wrapper needs its sibling binary."""
    real = Path(os.path.realpath(executable))
    for parent in real.parents:
        if parent.name == "node_modules":
            return parent
    return real.parent


def _is_under(path: Path, root: str) -> bool:
    return path == Path(root) or Path(root) in path.parents


def bwrap_argv(
    bwrap: str,
    *,
    executable: str,
    workspace: str,
    writable: list[Path],
) -> list[str]:
    """The bwrap prefix for a command: read-only everything, a private /tmp,
    and writes only where named.

    ``--unshare-pid`` with ``--die-with-parent`` means killing this one
    process ends everything the agent started, and so does ClawChat exiting.
    """
    argv = [
        bwrap,
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--tmpfs", "/dev/shm",
        "--unshare-pid",
        "--die-with-parent",
        "--new-session",
    ]
    # The private /tmp hides anything installed under it; put the install back.
    root = _install_root(executable)
    if _is_under(root, "/tmp"):
        argv += ["--ro-bind", str(root), str(root)]
    for path in [Path(workspace), *writable]:
        argv += ["--bind", str(path), str(path)]
    argv += ["--chdir", workspace]
    return argv


def run_config(
    *,
    model: str | None,
    tools_url: str | None = None,
    tools_token: str | None = None,
    tool_timeout_ms: int | None = None,
) -> dict[str, Any]:
    """The configuration ClawChat pins for a run, on top of the repository's."""
    config: dict[str, Any] = {
        "$schema": "https://opencode.ai/config.json",
        "autoupdate": False,
        "share": "disabled",
        "permission": dict(RUN_PERMISSIONS),
    }
    if model:
        config["model"] = model
    if tools_url and tools_token:
        server: dict[str, Any] = {
            "type": "remote",
            "url": tools_url,
            "headers": {"Authorization": f"Bearer {tools_token}"},
            "oauth": False,
        }
        if tool_timeout_ms:
            server["timeout"] = tool_timeout_ms
        config["mcp"] = {"clawchat": server}
    return config


class OpenCodeServer:
    """HTTP client for one running server, scoped to one directory."""

    def __init__(self, base_url: str, password: str, directory: str):
        self.base_url = base_url
        self.directory = directory
        self._auth = httpx.BasicAuth(SERVER_USERNAME, password)
        self._client = httpx.AsyncClient(
            base_url=base_url,
            auth=self._auth,
            params={"directory": directory},
            timeout=30,
        )

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise OpenCodeError("unreachable", f"OpenCode server is unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise OpenCodeError(
                "request_failed",
                f"OpenCode {method} {path} failed ({response.status_code}): {response.text[:300]}",
            )
        return response

    async def create_session(self, title: str) -> str:
        response = await self._request("POST", "/session", json={"title": title})
        return response.json()["id"]

    async def prompt(self, session_id: str, text: str) -> None:
        await self._request(
            "POST",
            f"/session/{session_id}/prompt_async",
            json={"parts": [{"type": "text", "text": text}]},
        )

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """The server's event stream, one decoded event at a time."""
        async with httpx.AsyncClient(
            base_url=self.base_url,
            auth=self._auth,
            params={"directory": self.directory},
            timeout=httpx.Timeout(30, read=None),
        ) as client:
            async with client.stream("GET", "/event") as response:
                if response.status_code >= 400:
                    raise OpenCodeError(
                        "request_failed",
                        f"OpenCode event stream failed ({response.status_code})",
                    )
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        yield json.loads(line[5:])
                    except json.JSONDecodeError:
                        logger.debug("Skipping undecodable OpenCode event: %s", line[:200])

    async def reply_permission(self, request_id: str, reply: str, message: str | None = None) -> None:
        body: dict[str, Any] = {"reply": reply}
        if message:
            body["message"] = message
        await self._request("POST", f"/permission/{request_id}/reply", json=body)

    async def reject_question(self, request_id: str) -> None:
        await self._request("POST", f"/question/{request_id}/reject")

    async def abort(self, session_id: str) -> None:
        await self._request("POST", f"/session/{session_id}/abort")

    async def messages(self, session_id: str) -> list[dict[str, Any]]:
        return (await self._request("GET", f"/session/{session_id}/message")).json()

    async def diff(self, session_id: str, message_id: str | None = None) -> list[dict[str, Any]]:
        params = {"messageID": message_id} if message_id else None
        return (
            await self._request("GET", f"/session/{session_id}/diff", params=params)
        ).json()

    async def aclose(self) -> None:
        await self._client.aclose()


class OpenCodeAdapter:
    host_label = "local"

    def __init__(
        self,
        *,
        command: str = "opencode",
        enabled: bool = False,
        sandbox: str = "bwrap",
        startup_timeout_seconds: float = 30.0,
    ) -> None:
        self.command = command.strip() or "opencode"
        self.enabled = enabled
        self.sandbox = sandbox.strip().lower()
        self.startup_timeout_seconds = startup_timeout_seconds

    @property
    def executable(self) -> str | None:
        return find_executable(self.command)

    def sandbox_problem(self) -> str | None:
        """Why runs cannot be confined here, or None when they can."""
        if self.sandbox == "none":
            return None
        if self.sandbox != "bwrap":
            return f"Unknown OPENCODE_SANDBOX {self.sandbox!r}; use one of {', '.join(SANDBOXES)}"
        if not sys.platform.startswith("linux"):
            return (
                "The bwrap sandbox needs Linux. Set OPENCODE_SANDBOX=none to run "
                "OpenCode unconfined on this machine."
            )
        if not shutil.which("bwrap"):
            return "bubblewrap (bwrap) is not installed, so runs cannot be confined"
        return None

    async def health(self) -> dict[str, Any]:
        status: dict[str, Any] = {
            "enabled": self.enabled,
            "available": False,
            "connected": False,
            "host": "ClawChat server",
            "error": None,
            "providers": [],
        }
        if not self.enabled:
            status["error"] = "OpenCode execution is disabled"
            return status
        executable = self.executable
        if not executable:
            status["error"] = f"OpenCode executable was not found: {self.command}"
            return status
        status["available"] = True
        problem = self.sandbox_problem() or await asyncio.to_thread(self._probe_sandbox)
        if problem:
            status["error"] = problem
            return status
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [executable, "--version"],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            status["error"] = f"OpenCode did not start: {exc}"
            return status
        if result.returncode != 0:
            status["error"] = f"OpenCode did not start: {result.stderr.strip()[:200]}"
            return status
        status["connected"] = True
        status["providers"] = [
            {"provider": "opencode", "version": result.stdout.strip(), "sandbox": self.sandbox}
        ]
        return status

    def _probe_sandbox(self) -> str | None:
        """bwrap can be installed yet refused user namespaces (e.g. in Docker)."""
        if self.sandbox != "bwrap":
            return None
        try:
            result = subprocess.run(
                [shutil.which("bwrap") or "bwrap", "--ro-bind", "/", "/", "--unshare-pid", "true"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return f"bubblewrap could not start: {exc}"
        if result.returncode != 0:
            return f"bubblewrap cannot create a sandbox here: {result.stderr.strip()[:200]}"
        return None

    def _argv(self, executable: str, workspace: str) -> list[str]:
        serve = [executable, "serve", "--hostname", "127.0.0.1", "--port", "0"]
        if self.sandbox != "bwrap":
            return serve
        writable = state_dirs(os.environ, Path.home())
        for path in writable:
            path.mkdir(parents=True, exist_ok=True)
        return bwrap_argv(
            shutil.which("bwrap") or "bwrap",
            executable=executable,
            workspace=workspace,
            writable=[Path(os.path.realpath(path)) for path in writable],
        ) + serve

    @asynccontextmanager
    async def serve(
        self, workspace: str, *, config: dict[str, Any]
    ) -> AsyncIterator[OpenCodeServer]:
        """Start a server confined to ``workspace``; stop it, and all it started, on exit."""
        executable = self.executable
        if not executable:
            raise OpenCodeError("not_installed", f"OpenCode executable was not found: {self.command}")
        problem = self.sandbox_problem()
        if problem:
            raise OpenCodeError("sandbox_unavailable", problem)
        directory = os.path.realpath(os.path.expanduser(workspace))
        if not os.path.isdir(directory):
            raise OpenCodeError("workspace_missing", f"{workspace} does not exist on this machine")

        password = secrets.token_urlsafe(24)
        env = {
            **os.environ,
            "OPENCODE_SERVER_PASSWORD": password,
            "OPENCODE_CONFIG_CONTENT": json.dumps(config),
            # Skills come from the project and OpenCode's own config, not from
            # whatever this account keeps for Claude Code.
            "OPENCODE_DISABLE_CLAUDE_CODE": "1",
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
        }
        # Popen runs on the event loop's thread on purpose: bwrap's
        # --die-with-parent follows the thread that started it.
        process = subprocess.Popen(
            self._argv(executable, directory),
            cwd=directory,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            start_new_session=self.sandbox != "bwrap" and os.name == "posix",
        )
        listening: Future[str] = Future()
        threading.Thread(
            target=_read_output, args=(process, listening), daemon=True
        ).start()
        server: OpenCodeServer | None = None
        try:
            try:
                base_url = await asyncio.wait_for(
                    asyncio.wrap_future(listening), self.startup_timeout_seconds
                )
            except asyncio.TimeoutError as exc:
                raise OpenCodeError(
                    "startup_timeout",
                    f"OpenCode did not start within {self.startup_timeout_seconds:g}s",
                ) from exc
            server = OpenCodeServer(base_url, password, directory)
            yield server
        finally:
            if server is not None:
                await server.aclose()
            await asyncio.to_thread(_stop, process, self.sandbox != "bwrap")


def _read_output(process: subprocess.Popen, listening: Future) -> None:
    """Find the address the server chose, then keep its output drained."""
    tail: deque[str] = deque(maxlen=20)
    assert process.stdout is not None
    for line in process.stdout:
        line = line.rstrip()
        tail.append(line)
        if not listening.done():
            match = _LISTENING.search(line)
            if match:
                listening.set_result(match.group(1).rstrip("/"))
                continue
        logger.debug("opencode: %s", line)
    if not listening.done():
        listening.set_exception(
            OpenCodeError(
                "startup_failed",
                "OpenCode exited before it started: " + " | ".join(tail)[-500:],
            )
        )


def _stop(process: subprocess.Popen, own_group: bool) -> None:
    if process.poll() is not None:
        return
    for sig, grace in ((signal.SIGTERM, 5), (getattr(signal, "SIGKILL", signal.SIGTERM), 5)):
        try:
            if own_group and hasattr(os, "killpg"):
                os.killpg(process.pid, sig)
            else:
                process.send_signal(sig)
        except ProcessLookupError:
            return
        try:
            process.wait(grace)
            return
        except subprocess.TimeoutExpired:
            continue
