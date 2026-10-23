import os
import subprocess
import sys
from queue import Queue

import pytest

from exceptions import AIUnavailableError
from services.ai import claude_code_provider as module
from services.ai.claude_code_provider import ClaudeCodeProvider


def completed(args, *, stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args, returncode, stdout, stderr)


async def test_completion_pins_the_configured_model(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120, *, input_text=None):
        captured["command"] = command
        captured["input_text"] = input_text
        system_file = command[command.index("--system-prompt-file") + 1]
        with open(system_file, encoding="utf-8") as handle:
            captured["system_prompt"] = handle.read()
        return completed(command, stdout="A useful answer\n")

    monkeypatch.setattr(module, "_find_claude_cli", lambda: "/opt/bin/claude")
    monkeypatch.setattr(module, "_run_cli_sync", fake_run)

    result = await ClaudeCodeProvider(model="sonnet").generate_completion(
        "Be concise.", "Help me plan today."
    )

    assert result == "A useful answer"
    system_file = captured["command"][-1]
    assert captured["command"] == [
        "/opt/bin/claude",
        "--print",
        "--output-format",
        "text",
        "--max-turns",
        "1",
        "--model",
        "sonnet",
        "--system-prompt-file",
        system_file,
    ]
    # Neither prompt rides on the command line Windows caps at ~32,000
    # characters: the system prompt is a file, the message goes in on stdin.
    assert captured["system_prompt"] == "Be concise."
    assert captured["input_text"] == "Help me plan today."
    # The file holds the system prompt only for as long as the CLI runs.
    assert not os.path.exists(system_file)


async def test_empty_model_defers_to_the_cli_default(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120, *, input_text=None):
        captured["command"] = command
        return completed(command, stdout="ok\n")

    monkeypatch.setattr(module, "_find_claude_cli", lambda: "/opt/bin/claude")
    monkeypatch.setattr(module, "_run_cli_sync", fake_run)

    await ClaudeCodeProvider().generate_completion("", "Hello")

    assert "--model" not in captured["command"]


# A prompt far past the ~32,000-character Windows command-line cap still
# reaches the CLI whole, because it travels on stdin.
_ECHO_STDIN_LENGTH = [sys.executable, "-c", "import sys; print(len(sys.stdin.read()))"]


def test_a_long_prompt_reaches_the_cli_on_stdin():
    prompt = "x" * 100_000

    result = module._run_cli_sync(_ECHO_STDIN_LENGTH, 30, input_text=prompt)

    assert result.stdout.strip() == "100000"


def test_a_streamed_prompt_reaches_the_cli_on_stdin():
    queue: Queue = Queue()

    module._stream_cli_lines(_ECHO_STDIN_LENGTH, queue, input_text="y" * 100_000)

    events = []
    while not queue.empty():
        events.append(queue.get())
    assert ("line", "100000") in events
    assert events[-1] == ("done", None)


async def test_no_system_prompt_file_without_a_system_prompt(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120, *, input_text=None):
        captured["command"] = command
        return completed(command, stdout="ok\n")

    monkeypatch.setattr(module, "_find_claude_cli", lambda: "/opt/bin/claude")
    monkeypatch.setattr(module, "_run_cli_sync", fake_run)

    await ClaudeCodeProvider().generate_completion("", "Hello")

    assert "--system-prompt-file" not in captured["command"]
    assert "--system-prompt" not in captured["command"]


async def test_a_failed_run_still_removes_the_system_prompt_file(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120, *, input_text=None):
        captured["system_file"] = command[command.index("--system-prompt-file") + 1]
        return completed(command, stderr="boom", returncode=1)

    monkeypatch.setattr(module, "_find_claude_cli", lambda: "/opt/bin/claude")
    monkeypatch.setattr(module, "_run_cli_sync", fake_run)

    with pytest.raises(AIUnavailableError):
        await ClaudeCodeProvider().generate_completion("Be concise.", "Hello")

    assert not os.path.exists(captured["system_file"])
