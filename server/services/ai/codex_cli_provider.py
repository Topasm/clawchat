"""Local Codex CLI provider.

The CLI's non-interactive ``codex exec`` command writes its final response to
stdout.  ClawChat runs it with a read-only sandbox, no approval prompts, and
ephemeral sessions while reusing the user's existing Codex login.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import AsyncIterator
from enum import StrEnum
from pathlib import Path

from exceptions import AIUnavailableError

logger = logging.getLogger(__name__)


class CodexCLIStatus(StrEnum):
    AVAILABLE = "available"
    NOT_INSTALLED = "not_installed"
    NOT_AUTHENTICATED = "not_authenticated"
    BUSY = "busy"
    ERROR = "error"


def _find_codex_cli() -> str | None:
    """Find Codex even when a packaged desktop app has a minimal PATH."""
    found = shutil.which("codex")
    if found:
        return found

    home = Path.home()
    executable_names = ("codex.exe", "codex.cmd", "codex") if sys.platform == "win32" else ("codex",)
    directories = [
        home / ".local" / "bin",
        home / ".codex" / "bin",
        home / ".local" / "share" / "mise" / "shims",
        home / ".asdf" / "shims",
        home / ".npm-global" / "bin",
        home / ".npm" / "bin",
        home / ".bun" / "bin",
        home / "AppData" / "Roaming" / "npm",
        home / "AppData" / "Local" / "pnpm",
        home / "scoop" / "shims",
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
        Path("/home/linuxbrew/.linuxbrew/bin"),
        Path("/Applications/Codex.app/Contents/Resources"),
        Path("/Applications/ChatGPT.app/Contents/Resources"),
    ]
    nvm_root = home / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        directories.extend(
            child / "bin" for child in sorted(nvm_root.iterdir(), reverse=True)
        )

    for directory in directories:
        for name in executable_names:
            candidate = directory / name
            if candidate.is_file():
                return str(candidate)
    return None


def _command(cli: str, *args: str) -> list[str]:
    if sys.platform == "win32" and Path(cli).suffix.lower() in {".cmd", ".bat"}:
        return ["cmd.exe", "/D", "/S", "/C", cli, *args]
    return [cli, *args]


def _run(
    cmd: list[str],
    *,
    input_text: str | None = None,
    timeout: int = 180,
    cwd: str | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        input=input_text,
        capture_output=True,
        timeout=timeout,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        cwd=cwd,
    )


class CodexCLIProvider:
    """AIService-compatible adapter around ``codex exec``."""

    def __init__(self, *, model: str = "", timeout_seconds: int = 180):
        self.model = model.strip()
        self.timeout_seconds = timeout_seconds
        self._cli_path: str | None = None
        self._working_directory = Path(tempfile.gettempdir()) / "clawchat-codex-cli"

    async def check_availability(self) -> tuple[CodexCLIStatus, str | None]:
        cli = _find_codex_cli()
        if not cli:
            return CodexCLIStatus.NOT_INSTALLED, None
        self._cli_path = cli
        try:
            version_result = await asyncio.to_thread(
                _run, _command(cli, "--version"), timeout=10
            )
            if version_result.returncode != 0:
                return CodexCLIStatus.ERROR, None
            version = version_result.stdout.strip() or None
            login_result = await asyncio.to_thread(
                _run, _command(cli, "login", "status"), timeout=10
            )
            if login_result.returncode != 0:
                return CodexCLIStatus.NOT_AUTHENTICATED, version
            return CodexCLIStatus.AVAILABLE, version
        except subprocess.TimeoutExpired:
            return CodexCLIStatus.ERROR, None
        except OSError:
            logger.exception("Codex CLI availability check failed")
            return CodexCLIStatus.ERROR, None

    async def health_check(self) -> bool:
        status, _ = await self.check_availability()
        return status == CodexCLIStatus.AVAILABLE

    def _exec_command(self) -> list[str]:
        cli = self._cli_path or _find_codex_cli()
        if not cli:
            raise AIUnavailableError("Codex CLI is not installed")
        args = [
            "--ask-for-approval",
            "never",
            "--sandbox",
            "read-only",
            "exec",
        ]
        if self.model:
            args.extend(["--model", self.model])
        args.extend(
            [
                "--skip-git-repo-check",
                "--ephemeral",
                "--ignore-rules",
                "--color",
                "never",
                "-",
            ]
        )
        return _command(cli, *args)

    async def _run_text(self, prompt: str, system_prompt: str | None = None) -> str:
        combined_prompt = "\n\n".join(
            part.strip() for part in (system_prompt or "", prompt) if part.strip()
        )
        try:
            await asyncio.to_thread(
                self._working_directory.mkdir, parents=True, exist_ok=True
            )
            result = await asyncio.to_thread(
                _run,
                self._exec_command(),
                input_text=combined_prompt or "Hello",
                timeout=self.timeout_seconds,
                cwd=str(self._working_directory),
            )
        except subprocess.TimeoutExpired as exc:
            raise AIUnavailableError("Codex CLI request timed out") from exc
        except OSError as exc:
            raise AIUnavailableError("Could not start Codex CLI") from exc

        if result.returncode != 0:
            error = (result.stderr or result.stdout).strip()
            lowered = error.lower()
            if any(word in lowered for word in ("login", "auth", "sign in", "unauthorized")):
                raise AIUnavailableError("Codex CLI is not authenticated; run `codex login`")
            if "rate limit" in lowered or "too many requests" in lowered:
                raise AIUnavailableError("Codex CLI is rate-limited; try again shortly")
            raise AIUnavailableError(
                f"Codex CLI failed (exit {result.returncode}): {error[:300]}"
            )
        output = result.stdout.strip()
        if len(output.encode("utf-8")) > 2 * 1024 * 1024:
            raise AIUnavailableError("Codex CLI response exceeded the 2 MiB limit")
        if not output:
            raise AIUnavailableError("Codex CLI returned an empty response")
        return output

    async def stream_completion(self, messages: list[dict]) -> AsyncIterator[str]:
        system_parts: list[str] = []
        conversation: list[str] = []
        for message in messages:
            role = message.get("role", "")
            content = message.get("content", "")
            if not isinstance(content, str) or not content:
                continue
            if role in {"system", "developer"}:
                system_parts.append(content)
            elif role == "assistant":
                conversation.append(f"Assistant: {content}")
            elif role == "user":
                conversation.append(f"User: {content}")
        yield await self._run_text(
            "\n\n".join(conversation) or "Hello",
            system_prompt="\n\n".join(system_parts),
        )

    async def generate_completion(self, system_prompt: str, user_message: str) -> str:
        return await self._run_text(user_message, system_prompt=system_prompt)

    async def generate_title(self, user_message: str) -> str:
        prompt = (
            "Generate a short title (max 6 words). Reply with only the title, "
            "without quotes or leading/trailing punctuation."
        )
        try:
            title = await self._run_text(user_message, system_prompt=prompt)
            return title[:60] if title else "New Conversation"
        except Exception:
            logger.warning("Codex CLI title generation failed, using fallback")
            return "New Conversation"

    async def function_call(
        self,
        system_prompt: str,
        user_message: str,
        tools: list[dict],
        tool_choice: dict | str = "auto",
    ) -> dict:
        functions = [tool["function"] for tool in tools if tool.get("type") == "function"]
        function_name = "classify"
        if isinstance(tool_choice, dict):
            function_name = tool_choice.get("function", {}).get("name", function_name)
        elif functions:
            function_name = functions[0].get("name", function_name)
        schema = functions[0].get("parameters", {}) if functions else {}
        json_prompt = (
            f"{system_prompt}\n\nRespond with only a JSON object matching this schema:\n"
            f"{json.dumps(schema, indent=2)}"
        )
        try:
            raw = await self._run_text(user_message, system_prompt=json_prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.splitlines()[1:])
            if cleaned.endswith("```"):
                cleaned = "\n".join(cleaned.splitlines()[:-1])
            arguments = json.loads(cleaned.strip())
        except Exception as exc:
            logger.warning("Codex CLI function_call JSON parse failed: %s", exc)
            arguments = {"intent": "general_chat"}
        return {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "function": {
                                    "name": function_name,
                                    "arguments": json.dumps(arguments),
                                }
                            }
                        ]
                    }
                }
            ]
        }

    async def close(self) -> None:
        return None
