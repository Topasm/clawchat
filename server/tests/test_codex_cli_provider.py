import subprocess

import pytest

from exceptions import AIUnavailableError
from services.ai import codex_cli_provider as module
from services.ai.codex_cli_provider import CodexCLIProvider, CodexCLIStatus


def completed(args, *, stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args, returncode, stdout, stderr)


async def test_availability_checks_version_and_saved_login(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        if "--version" in command:
            return completed(command, stdout="codex-cli 0.test\n")
        return completed(command, stdout="Logged in using ChatGPT\n")

    monkeypatch.setattr(module, "_find_codex_cli", lambda: "/opt/bin/codex")
    monkeypatch.setattr(module, "_run", fake_run)

    status, version = await CodexCLIProvider().check_availability()

    assert status == CodexCLIStatus.AVAILABLE
    assert version == "codex-cli 0.test"
    assert calls == [
        ["/opt/bin/codex", "--version"],
        ["/opt/bin/codex", "login", "status"],
    ]


async def test_exec_uses_read_only_ephemeral_mode_and_stdin(monkeypatch):
    captured = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured.update(kwargs)
        return completed(command, stdout="A useful answer\n")

    monkeypatch.setattr(module, "_find_codex_cli", lambda: "/opt/bin/codex")
    monkeypatch.setattr(module, "_run", fake_run)
    provider = CodexCLIProvider(model="gpt-test")

    result = await provider.generate_completion("Be concise.", "Help me plan today.")

    assert result == "A useful answer"
    assert captured["input_text"] == "Be concise.\n\nHelp me plan today."
    assert captured["command"] == [
        "/opt/bin/codex",
        "--ask-for-approval",
        "never",
        "--sandbox",
        "read-only",
        "exec",
        "--model",
        "gpt-test",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-rules",
        "--color",
        "never",
        "-",
    ]


async def test_exec_reports_missing_auth(monkeypatch):
    monkeypatch.setattr(module, "_find_codex_cli", lambda: "/opt/bin/codex")
    monkeypatch.setattr(
        module,
        "_run",
        lambda command, **kwargs: completed(
            command, returncode=1, stderr="Please login to continue"
        ),
    )

    with pytest.raises(AIUnavailableError, match="codex login"):
        await CodexCLIProvider().generate_completion("", "Hello")
