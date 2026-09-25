"""Read/control existing CLI sessions without importing them as task runs.

Codex uses the shared app-server socket. A separate stdio server is a read-only
history fallback and must never be mistaken for the live session owner.
Claude exposes session discovery and background controls through its CLI.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
from contextlib import asynccontextmanager
from pathlib import Path

from websockets.asyncio.client import unix_connect

from config import settings
from exceptions import ConflictError, NotFoundError
from schemas.cli_session import (
    CLIProviderState,
    CLISessionDetailResponse,
    CLISessionListResponse,
    CLISessionResponse,
)
from services.ai.claude_code_provider import _find_claude_cli
from services.ai.codex_cli_provider import _command, _find_codex_cli

MAX_OUTPUT = 16 * 1024 * 1024
SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")


class CLIConnectionError(RuntimeError):
    pass


def find_cli(provider: str) -> str | None:
    return _find_codex_cli() if provider == "codex" else _find_claude_cli()


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        try:
            process.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(process.wait(), 2)
        except TimeoutError:
            process.kill()
            await process.wait()


async def run_cli(*args: str) -> str:
    """Bounded, cancellable argv-only invocation; never run a shell or kill agents."""
    executable = find_cli(args[0])
    if executable is None:
        raise CLIConnectionError("CLI is not installed on this host")
    process = await asyncio.create_subprocess_exec(
        executable,
        *args[1:],
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(15):
            output = bytearray()
            while chunk := await process.stdout.read(64 * 1024):
                output.extend(chunk)
                if len(output) > MAX_OUTPUT:
                    raise CLIConnectionError("CLI response is too large")
            await process.wait()
        if process.returncode != 0:
            raise CLIConnectionError("CLI command failed")
        return output.decode("utf-8", errors="replace")
    finally:
        await _stop_process(process)


class CodexConnection:
    def __init__(self, send, receive, *, live: bool):
        self.send = send
        self.receive = receive
        self.live = live
        self.sequence = 0

    async def call(self, method: str, params: dict | None = None) -> dict:
        self.sequence += 1
        request_id = self.sequence
        await self.send(
            json.dumps({"id": request_id, "method": method, "params": params or {}})
        )
        async with asyncio.timeout(10):
            while True:
                raw = await self.receive()
                if not raw:
                    raise CLIConnectionError("Codex connection closed")
                response = json.loads(raw)
                # Server requests have their own ID space; they are not replies.
                if "method" in response:
                    continue
                if response.get("id") != request_id:
                    continue
                if "error" in response:
                    raise CLIConnectionError("Codex request failed")
                if "result" not in response:
                    raise CLIConnectionError("Invalid Codex response")
                return response["result"]

    async def initialize(self):
        await self.call(
            "initialize",
            {
                "clientInfo": {"name": "clawchat_sessions", "version": "1.0"},
            },
        )
        await self.send(json.dumps({"method": "initialized"}))


@asynccontextmanager
async def codex_connection(*, require_live: bool = False, prefer_live: bool = True):
    home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    socket = (
        Path(settings.cli_sessions_codex_socket).expanduser()
        if settings.cli_sessions_codex_socket
        else home / "app-server-control" / "app-server-control.sock"
    )
    ws = None
    if prefer_live and socket.exists():
        try:
            ws = await unix_connect(
                str(socket), open_timeout=2, close_timeout=1, max_size=MAX_OUTPUT
            )
            connection = CodexConnection(ws.send, ws.recv, live=True)
            await connection.initialize()
        except asyncio.CancelledError:
            if ws is not None:
                await ws.close()
            raise
        except Exception:
            if ws is not None:
                await ws.close()
            ws = None
    if ws is not None:
        try:
            yield connection
        finally:
            await ws.close()
        return
    if require_live:
        raise ConflictError(
            "The live Codex daemon is unavailable. Reconnect before controlling this session."
        )

    executable = find_cli("codex")
    if executable is None:
        raise CLIConnectionError("Codex is not installed on this host")
    process = await asyncio.create_subprocess_exec(
        *_command(executable, "app-server", "--stdio"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        limit=MAX_OUTPUT,
    )

    async def send(value):
        process.stdin.write((value + "\n").encode())
        await process.stdin.drain()

    try:
        connection = CodexConnection(send, process.stdout.readline, live=False)
        await connection.initialize()
        yield connection
    finally:
        await _stop_process(process)


def codex_session(thread: dict, *, live: bool) -> CLISessionResponse:
    raw_status = thread.get("status") or {}
    status = {"active": "running", "idle": "idle", "systemError": "failed"}.get(
        raw_status.get("type"), "unknown"
    )
    flags = raw_status.get("activeFlags", [])
    if any(flag in flags for flag in ("waitingOnApproval", "waitingOnUserInput")):
        status = "waiting_input"
    loaded = live and raw_status.get("type") in ("active", "idle")
    session_id = thread["id"]
    can_input = loaded and thread.get("canAcceptDirectInput", True)
    return CLISessionResponse(
        id=session_id,
        provider="codex",
        title=(thread.get("name") or thread.get("preview") or session_id)[:240],
        cwd=thread.get("cwd") or "",
        status=status if live else "unknown",
        kind="interactive" if loaded else "history",
        updated_at=thread.get("updatedAt"),
        can_send=can_input and status in ("running", "idle"),
        can_stop=loaded and status in ("running", "waiting_input"),
        can_read=True,
        resume_command=f"codex resume {shlex.quote(session_id)}",
    )


def claude_session(row: dict) -> CLISessionResponse | None:
    session_id = row.get("id") or row.get("sessionId")
    if not isinstance(session_id, str) or not SESSION_ID.fullmatch(session_id):
        return None
    background = row.get("kind") == "background" and bool(row.get("id"))
    state = row.get("state")
    status = {
        "working": "running",
        "blocked": "waiting_input",
        "done": "completed",
        "failed": "failed",
        "stopped": "stopped",
    }.get(state)
    if status is None:
        status = {"busy": "running", "waiting": "waiting_input", "idle": "idle"}.get(
            row.get("status"), "unknown"
        )
    resume = (
        f"claude attach {shlex.quote(session_id)}"
        if background
        else f"claude --resume {shlex.quote(session_id)}"
    )
    return CLISessionResponse(
        id=session_id,
        provider="claude",
        title=(row.get("name") or session_id)[:240],
        cwd=row.get("cwd") or "",
        kind="background" if background else "interactive",
        status=status,
        updated_at=(row.get("startedAt") or 0) / 1000 or None,
        waiting_for=row.get("waitingFor"),
        can_read=background,
        can_stop=background
        and status in ("running", "waiting_input", "idle", "completed"),
        can_restart=background and status in ("stopped", "failed"),
        resume_command=resume,
    )


class CLISessionService:
    async def codex_sessions(self):
        async with codex_connection() as connection:
            # Include live threads even if older than the first history page.
            loaded = (
                (await connection.call("thread/loaded/list")).get("data", [])
                if connection.live
                else []
            )
            page = await connection.call(
                "thread/list", {"limit": 100, "sortKey": "updated_at"}
            )
            threads = {t["id"]: t for t in page.get("data", [])}
            for session_id in loaded:
                if session_id not in threads:
                    result = await connection.call(
                        "thread/read", {"threadId": session_id}
                    )
                    threads[session_id] = result["thread"]
            return (
                [codex_session(t, live=connection.live) for t in threads.values()],
                CLIProviderState(
                    provider="codex",
                    connected=connection.live,
                    message=None
                    if connection.live
                    else "Live Codex connection unavailable. Saved sessions are available.",
                ),
            )

    async def claude_sessions(self):
        rows = json.loads(await run_cli("claude", "agents", "--json", "--all"))
        if not isinstance(rows, list):
            raise CLIConnectionError("Unsupported Claude session listing")
        return (
            [
                session
                for row in rows
                if isinstance(row, dict)
                if (session := claude_session(row)) is not None
            ],
            CLIProviderState(provider="claude", connected=True),
        )

    async def list(self) -> CLISessionListResponse:
        async def load(provider, loader):
            if not find_cli(provider):
                return [], CLIProviderState(
                    provider=provider,
                    connected=False,
                    message="CLI is not installed on this host.",
                )
            try:
                async with asyncio.timeout(20):
                    return await loader()
            except Exception:
                return [], CLIProviderState(
                    provider=provider,
                    connected=False,
                    message="Could not connect to the CLI on this host.",
                )

        results = await asyncio.gather(
            load("codex", self.codex_sessions), load("claude", self.claude_sessions)
        )
        sessions = [row for rows, _ in results for row in rows]
        rank = {"waiting_input": 0, "running": 1, "idle": 2}
        sessions.sort(key=lambda row: (rank.get(row.status, 3), -(row.updated_at or 0)))
        return CLISessionListResponse(
            sessions=sessions, providers=[state for _, state in results]
        )

    async def _claude(self, session_id):
        rows, _ = await self.claude_sessions()
        session = next((s for s in rows if s.id == session_id), None)
        if session is None:
            raise NotFoundError("CLI session is no longer available")
        return session

    async def detail(self, provider, session_id) -> CLISessionDetailResponse:
        if provider == "claude":
            session = await self._claude(session_id)
            output = (
                await run_cli("claude", "logs", session.id) if session.can_read else ""
            )
            # Terminal control sequences must never be interpreted by clients.
            output = re.sub(
                r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))", "", output
            )
            return CLISessionDetailResponse(session=session, output=output[-32_000:])
        async with codex_connection() as connection:
            result = await connection.call(
                "thread/read", {"threadId": session_id, "includeTurns": True}
            )
            thread = result["thread"]
            output = []
            for turn in thread.get("turns", [])[-10:]:
                for item in turn.get("items", []):
                    if item.get("type") == "agentMessage":
                        output.append(item.get("text", ""))
                    elif item.get("type") == "userMessage":
                        output.append(
                            "\n> "
                            + "\n".join(
                                c.get("text", "")
                                for c in item.get("content", [])
                                if c.get("type") == "text"
                            )
                        )
            return CLISessionDetailResponse(
                session=codex_session(thread, live=connection.live),
                output="\n\n".join(output)[-32_000:],
            )

    async def act(self, provider, session_id, action, message=None):
        if provider == "claude":
            session = await self._claude(session_id)
            if action == "stop" and session.can_stop:
                await run_cli("claude", "stop", session.id)
            elif action == "restart" and session.can_restart:
                await run_cli("claude", "respawn", session.id)
            else:
                raise ConflictError(
                    "This session does not support that action. Use its original terminal."
                )
            return
        async with codex_connection(require_live=True) as connection:
            thread = (
                await connection.call(
                    "thread/read", {"threadId": session_id, "includeTurns": True}
                )
            )["thread"]
            session = codex_session(thread, live=True)
            turn = next(
                (
                    t
                    for t in reversed(thread.get("turns", []))
                    if t.get("status") == "inProgress"
                ),
                None,
            )
            if action == "stop" and session.can_stop and turn:
                await connection.call(
                    "turn/interrupt", {"threadId": session_id, "turnId": turn["id"]}
                )
            elif (
                action == "message"
                and session.can_send
                and turn
                and message
                and message.strip()
            ):
                await connection.call(
                    "turn/steer",
                    {
                        "threadId": session_id,
                        "expectedTurnId": turn["id"],
                        "input": [{"type": "text", "text": message.strip()}],
                    },
                )
            elif (
                action == "message"
                and session.can_send
                and session.status == "idle"
                and message
                and message.strip()
            ):
                await connection.call(
                    "turn/start",
                    {
                        "threadId": session_id,
                        "input": [{"type": "text", "text": message.strip()}],
                    },
                )
            else:
                raise ConflictError(
                    "The session state changed or this action is unavailable. Refresh and try again."
                )
