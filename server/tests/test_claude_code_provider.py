import subprocess

from services.ai import claude_code_provider as module
from services.ai.claude_code_provider import ClaudeCodeProvider


def completed(args, *, stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args, returncode, stdout, stderr)


async def test_completion_pins_the_configured_model(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120):
        captured["command"] = command
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
        "-p",
        "Help me plan today.",
    ]


async def test_empty_model_defers_to_the_cli_default(monkeypatch):
    captured = {}

    def fake_run(command, timeout=120):
        captured["command"] = command
        return completed(command, stdout="ok\n")

    monkeypatch.setattr(module, "_find_claude_cli", lambda: "/opt/bin/claude")
    monkeypatch.setattr(module, "_run_cli_sync", fake_run)

    await ClaudeCodeProvider().generate_completion("", "Hello")

    assert "--model" not in captured["command"]
