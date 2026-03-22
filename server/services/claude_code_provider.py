import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from queue import Empty, Queue
from typing import Optional

from exceptions import AIUnavailableError

logger = logging.getLogger(__name__)


def _find_claude_cli() -> Optional[str]:
    """Locate the claude CLI, checking PATH and common install locations."""
    found = shutil.which("claude")
    if found:
        return found

    # Common install locations that might not be on the server's PATH
    home = Path.home()
    candidates = [
        home / ".local" / "bin" / ("claude.exe" if sys.platform == "win32" else "claude"),
        home / ".local" / "bin" / "claude.EXE",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "claude" / "claude.exe",
        home / ".claude" / "bin" / "claude",
        Path("/usr/local/bin/claude"),
        Path("/opt/homebrew/bin/claude"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    return None


class ClaudeCodeStatus(str, Enum):
    AVAILABLE = "available"
    NOT_INSTALLED = "not_installed"
    NOT_AUTHENTICATED = "not_authenticated"
    BUSY = "busy"
    ERROR = "error"


@dataclass
class ClaudeCodeError(Exception):
    status: ClaudeCodeStatus
    message: str
    recoverable: bool


def _run_cli_sync(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    """Run a CLI command synchronously (safe for any event loop)."""
    return subprocess.run(
        cmd,
        capture_output=True,
        timeout=timeout,
        text=True,
    )


def _stream_cli_lines(cmd: list[str], queue: Queue, timeout: int = 180):
    """Run CLI and push stdout lines to a queue. Runs in a thread."""
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for line in proc.stdout:
            queue.put(("line", line.rstrip()))
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read()
            queue.put(("error", (proc.returncode, stderr)))
        queue.put(("done", None))
    except Exception as exc:
        queue.put(("error", (1, str(exc))))
        queue.put(("done", None))


class ClaudeCodeProvider:
    """Wraps the `claude` CLI as an AI provider for ClawChat.

    Uses subprocess.run / subprocess.Popen (via threads) to avoid
    Windows SelectorEventLoop incompatibility with asyncio subprocesses.
    """

    def __init__(self):
        self._cli_path: Optional[str] = None

    async def check_availability(self) -> tuple[ClaudeCodeStatus, Optional[str]]:
        """Check if claude CLI is installed.
        Returns (status, version_string_or_none).
        """
        cli = _find_claude_cli()
        if not cli:
            logger.warning("Claude Code CLI not found in PATH or common locations")
            return ClaudeCodeStatus.NOT_INSTALLED, None
        self._cli_path = cli
        logger.info("Found Claude Code CLI at: %s", cli)

        try:
            result = await asyncio.to_thread(
                _run_cli_sync, [cli, "--version"], 10
            )
            if result.returncode != 0:
                logger.error("claude --version failed (rc=%d): %s", result.returncode, result.stderr)
                return ClaudeCodeStatus.ERROR, None
            version = result.stdout.strip()
            return ClaudeCodeStatus.AVAILABLE, version
        except subprocess.TimeoutExpired:
            logger.error("Claude Code --version timed out")
            return ClaudeCodeStatus.ERROR, None
        except Exception:
            logger.exception("Claude Code availability check failed")
            return ClaudeCodeStatus.ERROR, None

    async def stream_response(
        self,
        message: str,
        session_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Stream a response from Claude Code CLI.

        Uses subprocess.Popen in a thread and yields text deltas.
        """
        cli = self._cli_path or _find_claude_cli()
        if not cli:
            raise ClaudeCodeError(
                status=ClaudeCodeStatus.NOT_INSTALLED,
                message="Claude Code CLI not found. Install from https://claude.ai/code",
                recoverable=False,
            )

        cmd = [
            cli, "--print",
            "--output-format", "stream-json",
            "--max-turns", "1",
            "--verbose",
        ]

        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])

        cmd.extend(["-p", message])

        queue: Queue = Queue()
        thread = threading.Thread(target=_stream_cli_lines, args=(cmd, queue), daemon=True)
        thread.start()

        has_streamed = False
        try:
            while True:
                # Poll the queue, yielding control to the event loop between checks
                try:
                    kind, data = await asyncio.to_thread(queue.get, True, 0.1)
                except Empty:
                    continue

                if kind == "done":
                    break
                if kind == "error":
                    rc, stderr = data
                    mapped = self.map_error(rc, stderr)
                    raise mapped
                if kind == "line":
                    decoded = data.strip()
                    if not decoded:
                        continue
                    try:
                        event = json.loads(decoded)
                        event_type = event.get("type", "")
                        if event_type == "content_block_delta":
                            delta = event.get("delta", {})
                            if delta.get("type") == "text_delta":
                                text = delta.get("text", "")
                                if text:
                                    has_streamed = True
                                    yield text
                        elif event_type == "result":
                            if not has_streamed:
                                result_text = event.get("result", "")
                                if result_text:
                                    yield result_text
                    except json.JSONDecodeError:
                        if decoded:
                            has_streamed = True
                            yield decoded
        finally:
            thread.join(timeout=5)

    def map_error(self, return_code: int, stderr: str) -> ClaudeCodeError:
        """Map CLI errors to structured error types."""
        stderr_lower = stderr.lower()
        if "not found" in stderr_lower or "command not found" in stderr_lower:
            return ClaudeCodeError(
                status=ClaudeCodeStatus.NOT_INSTALLED,
                message="Claude Code CLI not found. Install from https://claude.ai/code",
                recoverable=False,
            )
        if "auth" in stderr_lower or "login" in stderr_lower or "api key" in stderr_lower:
            return ClaudeCodeError(
                status=ClaudeCodeStatus.NOT_AUTHENTICATED,
                message="Claude Code is not authenticated. Run `claude login` to sign in.",
                recoverable=True,
            )
        if "busy" in stderr_lower or "rate limit" in stderr_lower:
            return ClaudeCodeError(
                status=ClaudeCodeStatus.BUSY,
                message="Claude Code is busy or rate-limited. Try again shortly.",
                recoverable=True,
            )
        return ClaudeCodeError(
            status=ClaudeCodeStatus.ERROR,
            message=f"Claude Code error (exit {return_code}): {stderr[:200]}",
            recoverable=True,
        )

    async def health_check(self) -> bool:
        """Quick check if Claude Code is available."""
        status, _ = await self.check_availability()
        return status == ClaudeCodeStatus.AVAILABLE

    # ── AIService-compatible interface ────────────────────────────────
    # These methods let ClaudeCodeProvider be used as a drop-in
    # replacement for AIService in the chat router and orchestrator.

    async def _run_text(self, prompt: str, system_prompt: str | None = None) -> str:
        """Non-streaming call: runs claude --print --output-format text."""
        cli = self._cli_path or _find_claude_cli()
        if not cli:
            raise AIUnavailableError("Claude Code CLI not found")

        cmd = [
            cli, "--print",
            "--output-format", "text",
            "--max-turns", "1",
        ]
        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])
        cmd.extend(["-p", prompt])

        try:
            result = await asyncio.to_thread(_run_cli_sync, cmd, 120)
            if result.returncode != 0:
                raise AIUnavailableError(f"Claude Code error: {result.stderr[:200]}")
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            raise AIUnavailableError("Claude Code timed out")

    async def stream_completion(self, messages: list[dict]) -> AsyncIterator[str]:
        """AIService-compatible streaming: converts messages list to a prompt."""
        system_prompt = None
        user_parts: list[str] = []

        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "system":
                system_prompt = content
            elif role == "user":
                user_parts.append(content)
            elif role == "assistant":
                user_parts.append(f"[Assistant]: {content}")

        prompt = "\n\n".join(user_parts) if user_parts else "Hello"

        async for token in self.stream_response(
            message=prompt,
            system_prompt=system_prompt,
        ):
            yield token

    async def generate_completion(self, system_prompt: str, user_message: str) -> str:
        """Non-streaming completion, matching AIService interface."""
        return await self._run_text(user_message, system_prompt=system_prompt)

    async def generate_title(self, user_message: str) -> str:
        """Generate a short conversation title."""
        system = (
            "Generate a short title (max 6 words) for a conversation that starts with "
            "the following user message. Reply with ONLY the title, no quotes or punctuation "
            "at the start/end."
        )
        try:
            title = await self._run_text(user_message, system_prompt=system)
            return title[:60] if title else "New Conversation"
        except Exception:
            logger.warning("Claude Code title generation failed, using fallback")
            return "New Conversation"

    async def function_call(
        self,
        system_prompt: str,
        user_message: str,
        tools: list[dict],
        tool_choice: dict | str = "auto",
    ) -> dict:
        """Emulate OpenAI function calling by asking Claude to output JSON.

        Returns a dict shaped like an OpenAI chat completion with tool_calls.
        """
        func_schemas = []
        for tool in tools:
            if tool.get("type") == "function":
                func_schemas.append(tool["function"])

        func_name = ""
        if isinstance(tool_choice, dict):
            func_name = tool_choice.get("function", {}).get("name", "")
        if not func_name and func_schemas:
            func_name = func_schemas[0].get("name", "classify")

        params_schema = func_schemas[0].get("parameters", {}) if func_schemas else {}

        json_system = (
            f"{system_prompt}\n\n"
            f"You MUST respond with ONLY a valid JSON object matching this schema:\n"
            f"{json.dumps(params_schema, indent=2)}\n\n"
            f"No explanation, no markdown fences, just the raw JSON object."
        )

        try:
            raw = await self._run_text(user_message, system_prompt=json_system)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:])
            if cleaned.endswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[:-1])
            cleaned = cleaned.strip()

            args = json.loads(cleaned)

            return {
                "choices": [{
                    "message": {
                        "tool_calls": [{
                            "function": {
                                "name": func_name,
                                "arguments": json.dumps(args),
                            }
                        }]
                    }
                }]
            }
        except (json.JSONDecodeError, Exception) as exc:
            logger.warning("Claude Code function_call JSON parse failed: %s", exc)
            return {
                "choices": [{
                    "message": {
                        "tool_calls": [{
                            "function": {
                                "name": func_name,
                                "arguments": json.dumps({"intent": "general_chat"}),
                            }
                        }]
                    }
                }]
            }

    async def close(self):
        """No-op — thread-based subprocesses clean up automatically."""
        pass
