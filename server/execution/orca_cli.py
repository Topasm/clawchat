"""Async client for an Orca runtime (``orca-ide serve``) on this machine.

Orca owns the agent: the worktree, the CLI (Codex, Claude...), its sandbox.
Two surfaces reach it. The ``orca-ide`` CLI with ``--json`` creates
worktrees, starts chats and reports their state. The rest -- the permission
mode, sending a message, answering an approval, stopping a turn, reading the
diff -- has no CLI verb, so it goes to the runtime's own socket: one
newline-delimited JSON request ``{id, authToken, method, params}`` per
connection, using the token Orca writes next to the socket in
``orca-runtime.json``. Writes carry an envelope with a sha256 fingerprint of
the canonical payload, which Orca checks before acting.

That socket is Orca's internal protocol, not a published API, so everything
that touches it lives here and fails as ``OrcaError`` with a code.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shlex
import shutil
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: The modes ClawChat may ask for. Orca's "full-access" (no sandbox, no
#: approvals) and "own" (whatever the CLI's config says) are refused.
ALLOWED_PERMISSION_MODES = ("ask", "auto")
#: Terminal states Orca reports for a chat's latest turn.
WORKING_STATES = frozenset({"working", "waiting"})
SETTLED_STATES = frozenset({"done", "idle"})


class OrcaError(RuntimeError):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass(frozen=True)
class OrcaWorktree:
    id: str
    path: str
    branch: str | None


@dataclass(frozen=True)
class OrcaChatState:
    session_id: str
    state: str
    last_message: str | None
    updated_at_ms: int | None


@dataclass(frozen=True)
class OrcaTranscript:
    state: str | None
    entries: tuple[dict[str, Any], ...]

    def reply_after_last_prompt(self) -> str | None:
        """The agent's last message after the latest user message, if any."""
        last_user = max(
            (
                i
                for i, entry in enumerate(self.entries)
                if entry.get("kind") == "message" and entry.get("role") == "user"
            ),
            default=-1,
        )
        replies = [
            str(entry.get("text") or "")
            for entry in self.entries[last_user + 1 :]
            if entry.get("kind") == "message" and entry.get("role") == "assistant"
        ]
        replies = [text for text in replies if text.strip()]
        return replies[-1] if replies else None


@dataclass(frozen=True)
class OrcaRequest:
    """Something the agent is waiting on the person for: an approval or a question."""

    item_id: str
    revision: int
    kind: str
    title: str
    detail: str
    options: tuple[dict[str, Any], ...]

    def option_for(self, *, allow: bool) -> str:
        """The option that means allow (or deny) for this request."""
        ids = [str(option.get("id")) for option in self.options if option.get("id")]
        if not ids:
            raise OrcaError("ORCA_REQUEST_INVALID", "Orca offered no answer to this request")
        if allow:
            for option in self.options:
                if str(option.get("intent") or "").startswith("allow"):
                    return str(option["id"])
            return "accept" if "accept" in ids else ids[0]
        for option in self.options:
            if str(option.get("intent") or "") in ("deny", "decline", "reject"):
                return str(option["id"])
        for candidate in ("decline", "deny", "reject", "cancel"):
            if candidate in ids:
                return candidate
        return ids[-1]


def canonical_json(value: Any) -> str:
    """Orca's fingerprint encoding: JSON with object keys sorted, no spaces."""
    if isinstance(value, dict):
        items = sorted(value.items())
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(v)}" for k, v in items) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def envelope(method: str, session_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    """The write envelope Orca checks: an idempotency id and the payload's digest."""
    digest = hashlib.sha256(
        canonical_json({"method": method, "sessionId": session_id, "fields": fields}).encode()
    ).hexdigest()
    return {
        "sessionId": session_id,
        "clientOperationId": f"{int(time.time() * 1000)}-{uuid.uuid4().hex}",
        "expectedRuntimeFence": None,
        "payloadFingerprint": digest,
    }


def default_user_data_path() -> Path:
    """Where Orca keeps its profile when ORCA_USER_DATA_PATH is not set."""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "orca"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or home) / "orca"
    return Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config") / "orca"


class OrcaAdapter:
    """Invoke Orca with argv arrays and socket calls; nothing goes through a shell."""

    def __init__(
        self,
        *,
        command: str = "orca-ide",
        user_data_path: str = "",
        enabled: bool = False,
        command_timeout_seconds: float = 30,
    ) -> None:
        argv = shlex.split(command)
        if not argv:
            raise ValueError("Orca CLI command cannot be empty")
        self.command = tuple(argv)
        self.user_data_path = user_data_path.strip()
        self.enabled = enabled
        self.command_timeout_seconds = command_timeout_seconds

    # -- plumbing ---------------------------------------------------------

    @property
    def host_label(self) -> str:
        return "local"

    @property
    def executable_available(self) -> bool:
        executable = self.command[0]
        return bool(Path(executable).is_file() or shutil.which(executable))

    def _profile(self) -> Path:
        return Path(self.user_data_path).expanduser() if self.user_data_path else default_user_data_path()

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        if self.user_data_path:
            env["ORCA_USER_DATA_PATH"] = str(self._profile())
        # Orca's own opt-outs; ClawChat sends nothing anywhere on its behalf.
        env["ORCA_TELEMETRY_DISABLED"] = "1"
        env["DO_NOT_TRACK"] = "1"
        return env

    def _require_enabled(self) -> None:
        if not self.enabled:
            raise OrcaError("ORCA_DISABLED", "Orca execution is disabled")

    async def _cli(self, *args: str, timeout: float | None = None) -> Any:
        """Run one ``orca-ide … --json`` command and return its ``result``."""
        self._require_enabled()
        if not self.executable_available:
            raise OrcaError("ORCA_CLI_NOT_FOUND", f"Orca CLI executable was not found: {self.command[0]}")
        limit = timeout or self.command_timeout_seconds
        try:
            process = await asyncio.create_subprocess_exec(
                *self.command,
                *args,
                "--json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                env=self._env(),
            )
        except OSError as exc:
            raise OrcaError("ORCA_START_FAILED", str(exc)) from exc
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=limit)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise OrcaError("ORCA_TIMEOUT", f"Orca command timed out after {limit:g}s") from exc
        output = stdout.decode("utf-8", errors="replace").strip()
        try:
            payload = json.loads(output) if output else None
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict) and payload.get("ok") is True:
            return payload.get("result")
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            error = payload["error"]
            raise OrcaError(
                str(error.get("code") or "ORCA_COMMAND_FAILED"),
                str(error.get("message") or "Orca command failed"),
                error.get("data"),
            )
        message = stderr.decode("utf-8", errors="replace").strip() or output
        raise OrcaError(
            "ORCA_COMMAND_FAILED",
            message[:1_000] or f"Orca exited with code {process.returncode}",
        )

    def _runtime(self) -> tuple[str, str]:
        """The local socket and its token, from the running Orca's metadata."""
        metadata_path = self._profile() / "orca-runtime.json"
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise OrcaError(
                "ORCA_NOT_RUNNING",
                f"Orca is not running for {self._profile()} (start `orca-ide serve`)",
            ) from exc
        socket_path = next(
            (
                str(transport.get("endpoint"))
                for transport in metadata.get("transports") or []
                if transport.get("kind") == "unix" and transport.get("endpoint")
            ),
            None,
        )
        token = metadata.get("authToken")
        if not socket_path or not token:
            raise OrcaError("ORCA_NOT_RUNNING", "Orca's runtime metadata has no local socket")
        return socket_path, str(token)

    async def _rpc(self, method: str, params: dict[str, Any] | None = None, *, timeout: float | None = None) -> Any:
        self._require_enabled()
        socket_path, token = self._runtime()
        request: dict[str, Any] = {"id": uuid.uuid4().hex, "authToken": token, "method": method}
        if params is not None:
            request["params"] = params
        limit = timeout or self.command_timeout_seconds
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_unix_connection(socket_path, limit=8 * 1024 * 1024), timeout=limit
            )
        except (OSError, asyncio.TimeoutError) as exc:
            raise OrcaError("ORCA_NOT_RUNNING", f"Could not reach Orca: {exc}") from exc
        try:
            writer.write((json.dumps(request) + "\n").encode())
            await writer.drain()
            line = await asyncio.wait_for(reader.readline(), timeout=limit)
        except asyncio.TimeoutError as exc:
            raise OrcaError("ORCA_TIMEOUT", f"Orca did not answer {method} within {limit:g}s") from exc
        except (OSError, ValueError) as exc:
            raise OrcaError("ORCA_NOT_RUNNING", f"Lost the connection to Orca: {exc}") from exc
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass
        try:
            response = json.loads(line)
        except json.JSONDecodeError as exc:
            raise OrcaError("ORCA_INVALID_JSON", f"Orca answered {method} with invalid JSON") from exc
        if not response.get("ok"):
            error = response.get("error") or {}
            raise OrcaError(
                str(error.get("code") or "ORCA_RPC_FAILED"),
                str(error.get("message") or f"Orca refused {method}"),
                error.get("data"),
            )
        return response.get("result")

    async def _write(
        self,
        method: str,
        session_id: str,
        fields: dict[str, Any],
        *,
        fingerprint_method: str | None = None,
    ) -> Any:
        result = await self._rpc(
            method,
            {"envelope": envelope(fingerprint_method or method, session_id, fields), **fields},
        )
        if isinstance(result, dict) and result.get("ok") is False:
            refusal = result.get("refusal") or {}
            raise OrcaError(
                str(refusal.get("code") or "ORCA_REFUSED"),
                str(refusal.get("message") or f"Orca refused {method}"),
            )
        return result

    # -- discovery --------------------------------------------------------

    async def health(self) -> dict[str, Any]:
        status: dict[str, Any] = {
            "enabled": self.enabled,
            "available": self.executable_available,
            "connected": False,
            "host": self.host_label,
            "error": None,
            "providers": [],
        }
        if not self.enabled:
            status["error"] = "Orca execution is disabled"
            return status
        if not status["available"]:
            status["error"] = f"Orca CLI executable was not found: {self.command[0]}"
            return status
        try:
            result = await self._cli("status", timeout=10)
            runtime = (result or {}).get("runtime") or {}
            if not runtime.get("reachable"):
                status["error"] = "Orca is not running (start `orca-ide serve`)"
                return status
            status["connected"] = True
            status["providers"] = await self.list_agents()
        except OrcaError as exc:
            status["error"] = exc.message
        return status

    async def list_agents(self) -> list[dict[str, Any]]:
        result = await self._cli("agent", "installed", timeout=15)
        return [
            {"provider": str(agent.get("id")), "label": str(agent.get("name") or agent.get("id"))}
            for agent in (result or {}).get("agents") or []
            if isinstance(agent, dict) and agent.get("id")
        ]

    # -- workspaces and chats ---------------------------------------------

    async def list_repos(self) -> list[dict[str, str]]:
        """The git repositories registered with Orca, as ``{path, name}``."""
        result = await self._cli("repo", "list", timeout=15)
        repos = result.get("repos") if isinstance(result, dict) else result
        listed = []
        for repo in repos or []:
            if not isinstance(repo, dict) or not repo.get("path"):
                continue
            if repo.get("kind", "git") != "git":
                continue
            path = str(repo["path"])
            listed.append({"path": path, "name": str(repo.get("displayName") or Path(path).name)})
        return listed

    async def ensure_repo(self, path: str) -> None:
        """Register the project folder with Orca unless it already is."""
        try:
            await self._cli("repo", "show", "--repo", f"path:{path}")
            return
        except OrcaError as exc:
            if exc.code in ("ORCA_DISABLED", "ORCA_CLI_NOT_FOUND", "ORCA_START_FAILED", "ORCA_TIMEOUT"):
                raise
        await self._cli("repo", "add", "--path", path)

    async def create_worktree(
        self,
        *,
        repo_path: str,
        name: str,
        branch: str | None = None,
        base_branch: str | None = None,
    ) -> OrcaWorktree:
        args = [
            "worktree",
            "create",
            "--repo",
            f"path:{repo_path}",
            "--name",
            name,
            "--no-parent",
            "--setup",
            "skip",
        ]
        if branch:
            args += ["--branch", branch]
        if base_branch:
            args += ["--base-branch", base_branch]
        result = await self._cli(*args, timeout=max(self.command_timeout_seconds, 120))
        worktree = (result or {}).get("worktree") or {}
        if not worktree.get("id") or not worktree.get("path"):
            raise OrcaError("ORCA_WORKTREE_INVALID", "Orca did not return the new worktree")
        return OrcaWorktree(
            id=str(worktree["id"]),
            path=str(worktree["path"]),
            branch=worktree.get("branch"),
        )

    async def remove_worktree(self, path: str, *, delete_branch: bool) -> None:
        """Remove an Orca worktree (and its branch) with whatever it holds."""
        args = ["worktree", "rm", "--worktree", f"path:{path}", "--force"]
        if delete_branch:
            args.append("--delete-branch")
        await self._cli(*args, timeout=max(self.command_timeout_seconds, 60))

    async def launch_chat(self, *, worktree_path: str, agent: str, model: str | None) -> str:
        """Start an idle chat with ``agent`` in the worktree; its Orca session id."""
        args = [
            "agent",
            "launch",
            "--agent",
            agent,
            "--worktree",
            f"path:{worktree_path}",
            "--surface",
            "chat",
        ]
        if model:
            args += ["--model", model]
        result = await self._cli(*args, timeout=max(self.command_timeout_seconds, 60))
        outcome = (result or {}).get("outcome") or {}
        if outcome.get("kind") != "structured" or not outcome.get("sessionId"):
            raise OrcaError(
                "ORCA_CHAT_UNAVAILABLE",
                f"Orca could not open {agent} as a chat here: "
                f"{((result or {}).get('receipt') or {}).get('detail') or 'no chat session'}",
            )
        return str(outcome["sessionId"])

    async def chat_state(self, session_id: str) -> OrcaChatState:
        result = await self._cli("agent", "show", f"orca_session_id:{session_id}")
        places = (result or {}).get("places") or []
        if not places:
            raise OrcaError("ORCA_CHAT_MISSING", f"Orca no longer has chat {session_id}")
        place = places[0]
        updated = place.get("updatedAt")
        return OrcaChatState(
            session_id=session_id,
            state=str(place.get("state") or "unknown").lower(),
            last_message=place.get("lastAssistantMessage"),
            updated_at_ms=int(updated) if isinstance(updated, (int, float)) else None,
        )

    async def transcript(self, session_id: str, *, limit: int = 30) -> OrcaTranscript:
        result = await self._cli("agent", "read", f"orca_session_id:{session_id}", "--limit", str(limit))
        entries = tuple(
            entry for entry in (result or {}).get("entries") or [] if isinstance(entry, dict)
        )
        state = (result or {}).get("state")
        return OrcaTranscript(state=str(state).lower() if state else None, entries=entries)

    async def set_permission_mode(self, session_id: str, mode: str) -> None:
        if mode not in ALLOWED_PERMISSION_MODES:
            raise OrcaError(
                "ORCA_PERMISSION_MODE_REFUSED",
                f"Orca permission mode {mode!r} is not allowed; use one of {', '.join(ALLOWED_PERMISSION_MODES)}",
            )
        await self._write(
            "agentSession.setOption", session_id, {"key": "permissionMode", "value": mode}
        )

    async def send(self, session_id: str, text: str) -> None:
        body = {"kind": "message", "role": "user", "blocks": [{"type": "text", "text": text}]}
        await self._write("agentSession.send", session_id, {"body": body})

    async def cancel(self, session_id: str) -> None:
        await self._write("agentSession.cancel", session_id, {})

    async def pending_requests(self, session_id: str) -> list[OrcaRequest]:
        """The approvals and questions the chat is waiting on right now."""
        version = str(uuid.uuid4())
        cursor = 0
        chunks: list[str] = []
        for _ in range(64):
            result = await self._rpc(
                "agentSession.currentRequests",
                {"sessionId": session_id, "version": version, "cursor": cursor},
            ) or {}
            marker_version = (result.get("marker") or {}).get("version")
            if result.get("restart") and marker_version and marker_version != version:
                version, cursor, chunks = str(marker_version), 0, []
                continue
            text = str(result.get("json") or "")
            chunks.append(text)
            next_cursor = result.get("nextCursor")
            if not text or not isinstance(next_cursor, int) or next_cursor <= cursor:
                break
            cursor = next_cursor
        raw = "".join(chunks)
        try:
            items = json.loads(raw) if raw else []
        except json.JSONDecodeError as exc:
            raise OrcaError("ORCA_INVALID_JSON", "Orca returned unreadable pending requests") from exc
        requests = []
        for item in items if isinstance(items, list) else []:
            body = item.get("body") or {}
            if (body.get("resolution") or {}).get("state", "pending") != "pending":
                continue
            if body.get("kind") not in ("approval", "question"):
                continue
            requests.append(
                OrcaRequest(
                    item_id=str(item.get("itemId")),
                    revision=int(item.get("revision") or 1),
                    kind=str(body.get("kind")),
                    title=str(body.get("title") or body.get("kind")),
                    detail=str(body.get("detail") or ""),
                    options=tuple(o for o in body.get("options") or [] if isinstance(o, dict)),
                )
            )
        return requests

    async def respond(self, session_id: str, request: OrcaRequest, *, allow: bool) -> None:
        fields = {
            "itemId": request.item_id,
            "expectedRevision": request.revision,
            "optionId": request.option_for(allow=allow),
        }
        method = "agentSession.respondToQuestion" if request.kind == "question" else "agentSession.respondToApproval"
        await self._write(
            method,
            session_id,
            fields,
            fingerprint_method=f"agentSession.respondTo:{request.kind}",
        )

    # -- changes ----------------------------------------------------------

    async def changed_files(self, worktree_path: str) -> list[dict[str, Any]]:
        result = await self._rpc(
            "git.status", {"worktree": f"path:{worktree_path}", "includeLineStats": True}
        )
        return [entry for entry in (result or {}).get("entries") or [] if isinstance(entry, dict)]

    async def file_diff(self, worktree_path: str, file_path: str, *, staged: bool) -> dict[str, Any]:
        return await self._rpc(
            "git.diff",
            {"worktree": f"path:{worktree_path}", "filePath": file_path, "staged": staged},
        ) or {}
