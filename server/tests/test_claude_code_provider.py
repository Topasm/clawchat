import subprocess
import sys
from queue import Queue

from services.ai import claude_code_provider as module
from services.ai.claude_code_provider import ClaudeCodeProvider


def completed(args, *, stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args, returncode, stdout, stderr)


async def test_completion_pins_the_configured_model(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120, *, input_text=None):
        captured["command"] = command
        captured["input_text"] = input_text
        return completed(command, stdout="A useful answer\n")

    monkeypatch.setattr(module, "_find_claude_cli", lambda: "/opt/bin/claude")
    monkeypatch.setattr(module, "_run_cli_sync", fake_run)

    result = await ClaudeCodeProvider(model="sonnet").generate_completion(
        "Be concise.", "Help me plan today."
    )

    assert result == "A useful answer"
    assert captured["command"] == [
        "/opt/bin/claude",
        "--print",
        "--output-format",
        "text",
        "--max-turns",
        "1",
        "--model",
        "sonnet",
        "--system-prompt",
        "Be concise.",
    ]
    # The prompt goes in on stdin, not on a command line Windows caps at ~32k.
    assert captured["input_text"] == "Help me plan today."


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
