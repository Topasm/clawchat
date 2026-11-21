"""ClawChat's own Orca runtime: start, watch and stop ``orca-ide serve``.

With ``ORCA_MANAGE_RUNTIME`` on (the default), the server runs one headless
Orca for itself in a private profile, so enabling Orca needs no hand-started
runtime and nothing of the user's own Orca setup is shared or changed.

- The profile is ClawChat's (``ORCA_USER_DATA_PATH``, by default ``orca``
  next to the server's uploads folder), bound to 127.0.0.1 with pairing off
  and Orca's telemetry opt-outs set.
- Before the first start, Orca's agent status hooks are turned off for that
  profile. A first ``serve`` with hooks on writes them into
  ``~/.claude/settings.json``, ``~/.codex/hooks.json`` and ``~/.codex/config.toml``
  at once, and ``agent hooks off`` leaves ``"hooks": {}`` stubs behind in
  every agent's config, so it runs before Orca ever has, with ``HOME`` pointed
  at a scratch folder inside the profile: the setting lands in the profile and
  the stubs land in the scratch folder.
- Ready means Orca wrote a new ``orca-runtime.json`` and its socket answers.
  Orca leaves the old file behind when it stops, so the file alone proves
  nothing.
- A runtime that dies is started again with growing delays; one that stays up
  for a minute resets them. On shutdown the runtime is stopped with its whole
  process group.
- A runtime already serving the profile is reused instead of starting a
  second one. If ClawChat started it (a server that was killed before it
  could stop Orca), it is taken back and stopped on shutdown as usual;
  anyone else's is left running.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import shlex
import shutil
import signal
import socket
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

RUNTIME_FILE = "orca-runtime.json"
#: Where ``agent hooks off`` may leave its stubs instead of the user's home.
SCRATCH_HOME = "clawchat-scratch-home"
#: Orca's serve output, kept beside its own logs for diagnosis.
SERVE_LOG = "clawchat-orca-serve.log"
SERVE_LOG_MAX_BYTES = 2 * 1024 * 1024
#: The runtime this ClawChat started, so a restarted server can take it back.
OWNER_FILE = "clawchat-runtime.json"
#: ``orca-ide serve`` refuses a profile another Orca holds. Its help names exit
#: code 3; 1.4.267 exits 78 with an ``OrcadInstanceLockError``.
PROFILE_TAKEN_EXIT_CODES = frozenset({3, 78})
PROFILE_TAKEN_MARKERS = ("OrcadInstanceLockError", "already owns the data root", "already serves this profile")
#: Inherited variables that would point the CLI at another Orca.
FOREIGN_ORCA_VARIABLES = ("ORCA_ENVIRONMENT", "ORCA_PAIRING_CODE", "ORCA_REMOTE_PAIRING")
_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_JSON_MESSAGE = re.compile(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"')
#: Log lines that are never the reason Orca stopped: stack frames, JSON pieces.
_NOT_A_REASON = ("at ", "{", "}", "[", "]", '"', "'")

#: Runtime states reported to the provider status.
STARTING = "starting"
RUNNING = "running"
REUSED = "reused"
RESTARTING = "restarting"
FAILED = "failed"
STOPPED = "stopped"
READY_STATES = frozenset({RUNNING, REUSED})


def orca_environment(profile: Path | None, base: Mapping[str, str] | None = None) -> dict[str, str]:
    """The environment every ``orca-ide`` call gets: this profile, no telemetry."""
    env = dict(os.environ if base is None else base)
    for name in FOREIGN_ORCA_VARIABLES:
        env.pop(name, None)
    if profile is not None:
        env["ORCA_USER_DATA_PATH"] = str(profile)
    # Orca's own opt-outs; ClawChat sends nothing anywhere on its behalf.
    env["ORCA_TELEMETRY_DISABLED"] = "1"
    env["DO_NOT_TRACK"] = "1"
    return env


@dataclass(frozen=True)
class RuntimeInfo:
    """What a running Orca wrote into ``orca-runtime.json``."""

    runtime_id: str | None
    pid: int | None
    socket_path: str | None


def read_runtime_info(profile: Path) -> RuntimeInfo | None:
    try:
        metadata = json.loads((profile / RUNTIME_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(metadata, dict):
        return None
    socket_path = next(
        (
            str(transport.get("endpoint"))
            for transport in metadata.get("transports") or []
            if isinstance(transport, dict) and transport.get("kind") == "unix" and transport.get("endpoint")
        ),
        None,
    )
    pid = metadata.get("pid")
    return RuntimeInfo(
        runtime_id=str(metadata["runtimeId"]) if metadata.get("runtimeId") else None,
        pid=pid if isinstance(pid, int) else None,
        socket_path=socket_path,
    )


async def socket_answers(socket_path: str | None, *, timeout: float = 2.0) -> bool:
    """True when something accepts connections on Orca's local socket."""
    if not socket_path:
        return False
    try:
        _reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(socket_path), timeout=timeout)
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    with contextlib.suppress(OSError):
        await writer.wait_closed()
    return True


async def live_runtime(profile: Path) -> RuntimeInfo | None:
    """The runtime serving ``profile`` right now, if one answers."""
    info = read_runtime_info(profile)
    if info is not None and await socket_answers(info.socket_path):
        return info
    return None


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _signal_group(process: asyncio.subprocess.Process, sig: int) -> None:
    """Signal ``serve`` and everything it started (its own session on POSIX)."""
    killpg = getattr(os, "killpg", None)
    with contextlib.suppress(ProcessLookupError, PermissionError):
        if killpg is not None:
            killpg(process.pid, sig)
        else:
            process.terminate()


class OrcaRuntimeError(RuntimeError):
    pass


class OrcaRuntimeSupervisor:
    """Keep one ``orca-ide serve`` alive for ClawChat's private profile."""

    def __init__(
        self,
        *,
        command: str | Sequence[str] = "orca-ide",
        profile: str | Path,
        port: int = 0,
        startup_timeout: float = 60.0,
        command_timeout: float = 30.0,
        backoff_initial: float = 1.0,
        backoff_max: float = 60.0,
        stable_after: float = 60.0,
        watch_interval: float = 5.0,
        stop_timeout: float = 15.0,
        base_env: Mapping[str, str] | None = None,
    ) -> None:
        argv = shlex.split(command) if isinstance(command, str) else list(command)
        if not argv:
            raise ValueError("Orca CLI command cannot be empty")
        self.command = tuple(argv)
        self.profile = Path(profile).expanduser().absolute()
        self.port = port
        self.startup_timeout = startup_timeout
        self.command_timeout = command_timeout
        self.backoff_initial = backoff_initial
        self.backoff_max = backoff_max
        self.stable_after = stable_after
        self.watch_interval = watch_interval
        self.stop_timeout = stop_timeout
        self.base_env = dict(base_env) if base_env is not None else None

        self.state = STOPPED
        self.error: str | None = None
        self.restarts = 0
        self.pid: int | None = None
        self.bound_port: int | None = None
        self._process: asyncio.subprocess.Process | None = None
        #: The runtime this server answers for: one it started or took back.
        self._own_runtime_id: str | None = None
        self._task: asyncio.Task | None = None
        self._ready = asyncio.Event()
        self._stopping = False
        self._hooks_off = False

    # -- public -----------------------------------------------------------

    @property
    def ready(self) -> bool:
        return self.state in READY_STATES

    def status(self) -> dict[str, Any]:
        return {
            "managed": True,
            "state": self.state,
            "error": self.error,
            "pid": self.pid,
            "port": self.bound_port,
            "profile": str(self.profile),
            "restarts": self.restarts,
        }

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stopping = False
        self._set(STARTING)
        self._task = asyncio.create_task(self._supervise(), name="orca-runtime")

    async def wait_ready(self, timeout: float | None = None) -> bool:
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return False
        return self.ready

    async def stop(self) -> None:
        self._stopping = True
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self._terminate()
        self._set(STOPPED)

    # -- supervision ------------------------------------------------------

    def _set(self, state: str, error: str | None = None) -> None:
        self.state = state
        self.error = error
        if state in READY_STATES:
            self._ready.set()
        else:
            self._ready.clear()

    def _env(self, *, home: Path | None = None) -> dict[str, str]:
        env = orca_environment(self.profile, self.base_env)
        if home is not None:
            env["HOME"] = str(home)
        return env

    def _executable_available(self) -> bool:
        executable = self.command[0]
        return bool(Path(executable).is_file() or shutil.which(executable))

    async def _supervise(self) -> None:
        failures = 0
        while not self._stopping:
            reused = await live_runtime(self.profile)
            if reused is not None:
                await self._watch_existing(reused)
                failures = 0
                continue
            started = time.monotonic()
            try:
                await self._run_once()
            except asyncio.CancelledError:
                raise
            except OrcaRuntimeError as exc:
                error = str(exc)
            except Exception as exc:  # noqa: BLE001 - a supervisor never dies of one start
                logger.exception("Orca runtime supervision failed")
                error = f"Orca could not be started: {exc}"
            else:
                error = "Orca stopped"
            if self._stopping:
                return
            if time.monotonic() - started >= self.stable_after:
                failures = 0
            delay = min(self.backoff_max, self.backoff_initial * (2**failures))
            failures += 1
            self.restarts += 1
            self._set(RESTARTING if self._executable_available() else FAILED, error)
            logger.warning("%s; starting it again in %.0fs", error, delay)
            await asyncio.sleep(delay)

    async def _watch_existing(self, info: RuntimeInfo) -> None:
        """Use a runtime that was already serving the profile, until it goes away."""
        adopted = info.runtime_id is not None and info.runtime_id == self._owned_runtime_id()
        self.pid, self.bound_port = info.pid, None
        if adopted:
            self._own_runtime_id = info.runtime_id
            self._set(RUNNING)
            logger.info("Took back the Orca runtime ClawChat started earlier (pid %s)", info.pid)
        else:
            self._set(REUSED)
            logger.info("Reusing the Orca runtime already serving %s (pid %s)", self.profile, info.pid)
        while not self._stopping:
            await asyncio.sleep(self.watch_interval)
            current = read_runtime_info(self.profile)
            if current is None or current.runtime_id != info.runtime_id:
                break
            if not await socket_answers(current.socket_path):
                break
        self.pid = None
        if not self._stopping:
            logger.info("The Orca runtime ClawChat was using stopped; starting its own")
            self._own_runtime_id = None
            self._set(STARTING)

    async def _run_once(self) -> None:
        if not self._executable_available():
            raise OrcaRuntimeError(f"Orca CLI executable was not found: {self.command[0]}")
        self.profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        await self._ensure_hooks_off()
        stale = read_runtime_info(self.profile)
        port = self.port or free_port()
        log_path = self._open_log_path()
        self._set(STARTING if self.restarts == 0 else RESTARTING, self.error)
        with open(log_path, "ab") as log:
            log.write(f"\n--- {time.strftime('%Y-%m-%dT%H:%M:%S')} starting on 127.0.0.1:{port}\n".encode())
            log.flush()
            try:
                process = await asyncio.create_subprocess_exec(
                    *self.command,
                    "serve",
                    "--port",
                    str(port),
                    "--bind",
                    "127.0.0.1",
                    "--no-pairing",
                    "--json",
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=log,
                    stderr=log,
                    env=self._env(),
                    start_new_session=os.name == "posix",
                )
            except OSError as exc:
                raise OrcaRuntimeError(f"Orca could not be started: {exc}") from exc
        self._process = process
        self.pid, self.bound_port = process.pid, port
        exited = asyncio.ensure_future(process.wait())
        try:
            info = await self._wait_until_ready(exited, stale)
            if info is None:
                code = process.returncode
                tail = self._log_tail(log_path)
                if code in PROFILE_TAKEN_EXIT_CODES or any(marker in tail for marker in PROFILE_TAKEN_MARKERS):
                    raise OrcaRuntimeError(f"Another Orca holds {self.profile}: {tail or f'exit code {code}'}")
                raise OrcaRuntimeError(f"Orca exited with code {code} while starting: {tail}".rstrip(": "))
            self._own_runtime_id = info.runtime_id
            self._record_owner(info)
            self._set(RUNNING)
            logger.info("Orca runtime ready on 127.0.0.1:%s (profile %s)", port, self.profile)
            await asyncio.shield(exited)
            tail = self._log_tail(log_path)
            raise OrcaRuntimeError(f"Orca exited with code {process.returncode}: {tail}".rstrip(": "))
        finally:
            await self._terminate()
            exited.cancel()
            self._process = None
            self.pid = None

    async def _wait_until_ready(self, exited: asyncio.Future, stale: RuntimeInfo | None) -> RuntimeInfo | None:
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            if exited.done():
                return None
            info = read_runtime_info(self.profile)
            fresh = info is not None and (stale is None or info.runtime_id != stale.runtime_id)
            if fresh and await socket_answers(info.socket_path):
                return info
            await asyncio.wait({exited}, timeout=0.2)
        raise OrcaRuntimeError(f"Orca did not become ready within {self.startup_timeout:g}s")

    async def _terminate(self) -> None:
        """Stop the runtime this server answers for: its process group, then its orcad."""
        process = self._process
        if process is not None and process.returncode is None:
            _signal_group(process, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=self.stop_timeout)
            except asyncio.TimeoutError:
                _signal_group(process, getattr(signal, "SIGKILL", signal.SIGTERM))
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(process.wait(), timeout=5)
        await self._stop_own_orcad()
        self._own_runtime_id = None

    async def _stop_own_orcad(self) -> None:
        """``serve`` runs the server as a child; make sure ours did not outlive it.

        Only a runtime that is ours by id and still answers on its socket is
        signalled, so a stale ``orca-runtime.json`` whose pid now belongs to
        something else is never touched.
        """
        if self._own_runtime_id is None:
            return
        info = read_runtime_info(self.profile)
        if info is None or info.runtime_id != self._own_runtime_id or info.pid is None:
            return
        if not await socket_answers(info.socket_path):
            return
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(info.pid, signal.SIGTERM)
        deadline = time.monotonic() + self.stop_timeout
        while time.monotonic() < deadline:
            if not await socket_answers(info.socket_path, timeout=0.5):
                return
            await asyncio.sleep(0.2)
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(info.pid, getattr(signal, "SIGKILL", signal.SIGTERM))

    def _record_owner(self, info: RuntimeInfo) -> None:
        with contextlib.suppress(OSError):
            (self.profile / OWNER_FILE).write_text(
                json.dumps({"runtimeId": info.runtime_id, "pid": info.pid, "startedAt": int(time.time())}),
                encoding="utf-8",
            )

    def _owned_runtime_id(self) -> str | None:
        try:
            recorded = json.loads((self.profile / OWNER_FILE).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return str(recorded.get("runtimeId")) if isinstance(recorded, dict) and recorded.get("runtimeId") else None

    # -- hooks ------------------------------------------------------------

    async def _ensure_hooks_off(self) -> None:
        """Turn Orca's agent hooks off in this profile before it ever serves."""
        if self._hooks_off:
            return
        scratch = self.profile / SCRATCH_HOME
        scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
        status = await self._cli_json("agent", "hooks", "status", home=scratch)
        if not (isinstance(status, dict) and status.get("enabled") is False):
            result = await self._cli_json("agent", "hooks", "off", home=scratch)
            if not (isinstance(result, dict) and result.get("enabled") is False):
                raise OrcaRuntimeError("Orca did not confirm its agent hooks are off; not starting it")
            logger.info("Turned Orca's agent hooks off for %s", self.profile)
        self._hooks_off = True

    async def _cli_json(self, *args: str, home: Path | None = None) -> Any:
        try:
            process = await asyncio.create_subprocess_exec(
                *self.command,
                *args,
                "--json",
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self._env(home=home),
                cwd=str(self.profile),
            )
        except OSError as exc:
            raise OrcaRuntimeError(f"Orca could not be started: {exc}") from exc
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=self.command_timeout)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise OrcaRuntimeError(f"`orca-ide {' '.join(args)}` timed out") from exc
        try:
            payload = json.loads(stdout.decode("utf-8", errors="replace") or "null")
        except ValueError:
            payload = None
        if isinstance(payload, dict) and payload.get("ok") is True:
            return payload.get("result")
        message = ""
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            message = str(payload["error"].get("message") or "")
        message = message or _ANSI.sub("", stderr.decode("utf-8", errors="replace")).strip()[-300:]
        raise OrcaRuntimeError(
            f"`orca-ide {' '.join(args)}` failed: {message or f'exit code {process.returncode}'}"
        )

    # -- logs -------------------------------------------------------------

    def _open_log_path(self) -> Path:
        path = self.profile / SERVE_LOG
        with contextlib.suppress(OSError):
            if path.stat().st_size > SERVE_LOG_MAX_BYTES:
                path.unlink()
        return path

    @staticmethod
    def _log_tail(path: Path) -> str:
        """Why Orca's last start ended, from what it printed, for the status.

        ``serve --json`` reports its own exit as a JSON error object
        (``"Orca serve exited via SIGKILL."``); otherwise the last line of text.
        """
        try:
            with open(path, "rb") as log:
                log.seek(0, os.SEEK_END)
                log.seek(max(0, log.tell() - 16384))
                text = log.read().decode("utf-8", errors="replace")
        except OSError:
            return ""
        text = _ANSI.sub("", text).rsplit("\n--- ", 1)[-1]
        failure = text.rfind('"ok": false')
        if failure != -1:
            message = _JSON_MESSAGE.search(text, failure)
            if message:
                with contextlib.suppress(ValueError):
                    return str(json.loads(f'"{message.group(1)}"'))[:300]
        lines = [line.strip() for line in text.splitlines()[1:]]
        lines = [line for line in lines if re.search(r"[A-Za-z]{3}", line) and not line.startswith(_NOT_A_REASON)]
        return lines[-1][:300] if lines else ""
