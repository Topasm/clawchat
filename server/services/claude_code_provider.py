import asyncio
import json
import logging
import shutil
from dataclasses import dataclass
from enum import Enum
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)


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


class ClaudeCodeProvider:
    """Wraps the `claude` CLI as an AI provider for ClawChat.

    Uses `claude --print --output-format stream-json` for streaming responses.
    """

    def __init__(self):
        self._active_processes: dict[str, asyncio.subprocess.Process] = {}
        self._cli_path: Optional[str] = None

    async def check_availability(self) -> tuple[ClaudeCodeStatus, Optional[str]]:
        """Check if claude CLI is installed and authenticated.
        Returns (status, version_string_or_none).
        """
        cli = shutil.which("claude")
        if not cli:
            return ClaudeCodeStatus.NOT_INSTALLED, None
        self._cli_path = cli

        try:
            proc = await asyncio.create_subprocess_exec(
                cli, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                return ClaudeCodeStatus.ERROR, None
            version = stdout.decode().strip()

            # Check auth by running a trivial command
            proc = await asyncio.create_subprocess_exec(
                cli, "--print", "-p", "respond with ok",
                "--output-format", "text",
                "--max-turns", "1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            if proc.returncode != 0:
                err_text = stderr.decode().lower()
                if "auth" in err_text or "login" in err_text or "api key" in err_text:
                    return ClaudeCodeStatus.NOT_AUTHENTICATED, version
                return ClaudeCodeStatus.ERROR, version

            return ClaudeCodeStatus.AVAILABLE, version
        except asyncio.TimeoutError:
            return ClaudeCodeStatus.ERROR, None
        except Exception as e:
            logger.error(f"Claude Code availability check failed: {e}")
            return ClaudeCodeStatus.ERROR, None

    async def stream_response(
        self,
        message: str,
        session_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Stream a response from Claude Code CLI.

        Uses `claude --print --output-format stream-json` and yields text deltas.
        """
        cli = self._cli_path or shutil.which("claude")
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

        # If we have a session/conversation continuation, cancel any previous run
        if session_id and session_id in self._active_processes:
            await self.cancel_run(session_id)

        cmd.extend(["-p", message])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        if session_id:
            self._active_processes[session_id] = proc

        try:
            async for line in proc.stdout:
                decoded = line.decode().strip()
                if not decoded:
                    continue
                try:
                    event = json.loads(decoded)
                    # stream-json format emits objects with "type" field
                    if event.get("type") == "assistant" and "message" in event:
                        # Extract text content from the message
                        msg = event["message"]
                        if isinstance(msg, str):
                            yield msg
                        elif isinstance(msg, dict):
                            for block in msg.get("content", []):
                                if isinstance(block, dict) and block.get("type") == "text":
                                    yield block.get("text", "")
                    elif event.get("type") == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            yield delta.get("text", "")
                    elif event.get("type") == "result":
                        # Final result message
                        result_text = event.get("result", "")
                        if result_text:
                            yield result_text
                except json.JSONDecodeError:
                    # Non-JSON line, might be raw text output
                    if decoded:
                        yield decoded

            await proc.wait()

            if proc.returncode != 0:
                stderr_output = await proc.stderr.read()
                error_text = stderr_output.decode().strip()
                mapped = self.map_error(proc.returncode, error_text)
                raise mapped

        finally:
            if session_id:
                self._active_processes.pop(session_id, None)

    async def cancel_run(self, session_id: str) -> bool:
        """Cancel an active Claude Code run."""
        proc = self._active_processes.pop(session_id, None)
        if proc and proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()
            return True
        return False

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
