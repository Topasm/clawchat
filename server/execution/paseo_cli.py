"""Safe async wrapper around Paseo's official machine-readable CLI surface."""

from __future__ import annotations

import asyncio
import json
import os
import shlex
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class PaseoCLIError(RuntimeError):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass(frozen=True)
class PaseoWorkspace:
    id: str
    project: str
    name: str
    isolation: str
    cwd: str


@dataclass(frozen=True)
class PaseoAgent:
    id: str
    status: str
    provider: str
    cwd: str
    title: str | None = None


@dataclass(frozen=True)
class PaseoAgentSnapshot:
    id: str
    status: str
    provider: str
    model: str | None
    cwd: str
    worktree: str | None
    pending_permissions: tuple[dict[str, str], ...]
    usage: dict[str, Any] | None


class PaseoCLIAdapter:
    """Invoke Paseo with argv arrays; prompts and paths never pass through a shell."""

    def __init__(
        self,
        *,
        command: str = "paseo",
        host: str = "",
        enabled: bool = False,
        command_timeout_seconds: float = 30,
    ) -> None:
        argv = shlex.split(command)
        if not argv:
            raise ValueError("Paseo CLI command cannot be empty")
        self.command = tuple(argv)
        self.host = host.strip()
        self.enabled = enabled
        self.command_timeout_seconds = command_timeout_seconds

    @property
    def host_label(self) -> str:
        if not self.host:
            return "local"
        if "#offer=" in self.host:
            return "relay"
        parsed = urlparse(self.host if "://" in self.host else f"//{self.host}")
        return parsed.netloc or parsed.path or "remote"

    @property
    def executable_available(self) -> bool:
        executable = self.command[0]
        return bool(Path(executable).is_file() or shutil.which(executable))

    def _argv(self, *args: str, json_output: bool = True) -> list[str]:
        argv = [*self.command, *args]
        if json_output:
            argv.append("--json")
        return argv

    async def _invoke(
        self,
        *args: str,
        json_output: bool = True,
        timeout: float | None = None,
    ) -> Any:
        if not self.enabled:
            raise PaseoCLIError("PASEO_DISABLED", "Paseo execution is disabled")
        if not self.executable_available:
            raise PaseoCLIError(
                "PASEO_CLI_NOT_FOUND",
                f"Paseo CLI executable was not found: {self.command[0]}",
            )
        argv = self._argv(*args, json_output=json_output)
        process_env = os.environ.copy()
        if self.host:
            # Pairing offer URLs contain credentials in their fragment. Keep
            # them out of argv/process listings by using Paseo's documented
            # PASEO_HOST environment variable.
            process_env["PASEO_HOST"] = self.host
        else:
            process_env.pop("PASEO_HOST", None)
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=process_env,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout or self.command_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise PaseoCLIError(
                "PASEO_TIMEOUT", f"Paseo command timed out after {timeout or self.command_timeout_seconds:g}s"
            ) from exc
        except OSError as exc:
            raise PaseoCLIError("PASEO_START_FAILED", str(exc)) from exc

        output = stdout.decode("utf-8", errors="replace").strip()
        error_output = stderr.decode("utf-8", errors="replace").strip()
        if process.returncode != 0:
            code = "PASEO_COMMAND_FAILED"
            message = error_output or output or f"Paseo exited with code {process.returncode}"
            details: Any = None
            for candidate in (error_output, output):
                try:
                    parsed = json.loads(candidate)
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
                    error = parsed["error"]
                    code = str(error.get("code") or code)
                    message = str(error.get("message") or message)
                    details = error.get("details")
                    break
            raise PaseoCLIError(code, message, details)
        if not json_output:
            return output
        if not output:
            return None
        try:
            return json.loads(output)
        except json.JSONDecodeError as exc:
            raise PaseoCLIError(
                "PASEO_INVALID_JSON",
                "Paseo returned invalid JSON",
                output[:1_000],
            ) from exc

    async def health(self) -> dict[str, Any]:
        if not self.enabled:
            return {
                "enabled": False,
                "available": self.executable_available,
                "connected": False,
                "host": self.host_label,
                "error": "Paseo execution is disabled",
                "providers": [],
            }
        if not self.executable_available:
            return {
                "enabled": True,
                "available": False,
                "connected": False,
                "host": self.host_label,
                "error": f"Paseo CLI executable was not found: {self.command[0]}",
                "providers": [],
            }
        try:
            await self._invoke("workspace", "ls", timeout=10)
            providers = await self.list_providers()
            return {
                "enabled": True,
                "available": True,
                "connected": True,
                "host": self.host_label,
                "error": None,
                "providers": providers,
            }
        except PaseoCLIError as exc:
            return {
                "enabled": True,
                "available": True,
                "connected": False,
                "host": self.host_label,
                "error": exc.message,
                "providers": [],
            }

    async def list_providers(self) -> list[dict[str, Any]]:
        payload = await self._invoke("provider", "ls", timeout=10)
        return payload if isinstance(payload, list) else []

    async def create_workspace(
        self,
        *,
        path: str,
        isolation: str,
        title: str,
        branch_name: str | None = None,
        base_branch: str | None = None,
    ) -> PaseoWorkspace:
        args = [
            "workspace",
            "create",
            "--isolation",
            isolation,
            "--path",
            path,
            "--title",
            title,
        ]
        if isolation == "worktree":
            args.extend(["--mode", "branch-off"])
            if branch_name:
                args.extend(["--new-branch", branch_name])
            if base_branch:
                args.extend(["--base", base_branch])
        payload = await self._invoke(*args)
        if not isinstance(payload, dict) or not payload.get("workspaceId"):
            raise PaseoCLIError("PASEO_WORKSPACE_INVALID", "Paseo did not return a workspace ID")
        return PaseoWorkspace(
            id=str(payload["workspaceId"]),
            project=str(payload.get("project") or ""),
            name=str(payload.get("name") or title),
            isolation=str(payload.get("isolation") or isolation),
            cwd=str(payload.get("cwd") or path),
        )

    async def start_agent(
        self,
        *,
        workspace_id: str,
        provider_model: str,
        prompt: str,
        title: str,
        labels: dict[str, str] | None = None,
    ) -> PaseoAgent:
        args = [
            "run",
            "--workspace",
            workspace_id,
            "--provider",
            provider_model,
            "--title",
            title,
            "--background",
        ]
        for key, value in sorted((labels or {}).items()):
            args.extend(["--label", f"{key}={value}"])
        args.append(prompt)
        payload = await self._invoke(*args)
        if not isinstance(payload, dict) or not payload.get("agentId"):
            raise PaseoCLIError("PASEO_AGENT_INVALID", "Paseo did not return an agent ID")
        return PaseoAgent(
            id=str(payload["agentId"]),
            status=str(payload.get("status") or "created"),
            provider=str(payload.get("provider") or provider_model),
            cwd=str(payload.get("cwd") or ""),
            title=payload.get("title"),
        )

    async def inspect_agent(self, agent_id: str) -> PaseoAgentSnapshot:
        payload = await self._invoke("inspect", agent_id)
        if not isinstance(payload, dict) or not payload.get("Id"):
            raise PaseoCLIError("PASEO_AGENT_INVALID", "Paseo returned an invalid agent snapshot")
        pending = payload.get("PendingPermissions")
        permissions = tuple(
            {"id": str(item.get("id") or ""), "tool": str(item.get("tool") or "unknown")}
            for item in pending or []
            if isinstance(item, dict)
        )
        usage = payload.get("LastUsage")
        return PaseoAgentSnapshot(
            id=str(payload["Id"]),
            status=str(payload.get("Status") or "unknown").lower(),
            provider=str(payload.get("Provider") or ""),
            model=(None if payload.get("Model") in (None, "-", "default") else str(payload["Model"])),
            cwd=str(payload.get("Cwd") or ""),
            worktree=(None if payload.get("Worktree") in (None, "null", "-") else str(payload["Worktree"])),
            pending_permissions=permissions,
            usage=usage if isinstance(usage, dict) else None,
        )

    async def send_follow_up(self, agent_id: str, prompt: str) -> None:
        await self._invoke("send", agent_id, "--prompt", prompt, "--no-wait")

    async def stop_agent(self, agent_id: str) -> None:
        await self._invoke("stop", agent_id)

    async def logs(self, agent_id: str, *, tail: int = 200) -> str:
        return str(
            await self._invoke(
                "logs",
                "--tail",
                str(tail),
                agent_id,
                json_output=False,
                timeout=max(self.command_timeout_seconds, 60),
            )
        )
