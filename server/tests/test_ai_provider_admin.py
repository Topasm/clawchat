import os
import stat

import pytest

import routers.admin as admin_module
from config import Settings, settings
from main import app
from services.ai.codex_api_provider import CodexAPIStatus
from services.ai.codex_cli_provider import CodexCLIStatus


class StubAI:
    model = "openclaw-test"

    async def health_check(self) -> bool:
        return True


class StubCodex:
    model = "gpt-5.3-codex"
    base_url = "https://api.openai.com/v1"

    def __init__(
        self,
        api_key: str = "",
        status: CodexAPIStatus = CodexAPIStatus.AVAILABLE,
    ):
        self.api_key = api_key
        self.status = status

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def set_api_key(self, api_key: str) -> None:
        self.api_key = api_key

    async def check_availability(self) -> CodexAPIStatus:
        if not self.api_key:
            return CodexAPIStatus.NOT_CONFIGURED
        return self.status


class StubCodexCLI:
    model = ""

    async def check_availability(self):
        return CodexCLIStatus.AVAILABLE, "codex-cli 0.test"

    async def health_check(self) -> bool:
        return True


def _explode(*_args, **_kwargs):
    raise OSError("read-only data directory")


def _restore_state(key: str, previous) -> None:
    if previous is None:
        try:
            delattr(app.state, key)
        except (AttributeError, KeyError):
            pass
    else:
        setattr(app.state, key, previous)


@pytest.fixture
def ai_provider_state():
    keys = (
        "ai_service",
        "active_ai",
        "active_ai_provider",
        "ai_connected",
        "claude_code_status",
        "claude_code_version",
        "codex_api",
        "codex_api_status",
        "codex_cli",
        "codex_cli_status",
        "codex_cli_version",
    )
    previous = {key: getattr(app.state, key, None) for key in keys}
    openclaw = StubAI()
    codex = StubCodex(api_key="sk-existing-key-that-is-long-enough-for-tests")
    app.state.ai_service = openclaw
    app.state.active_ai = openclaw
    app.state.active_ai_provider = "openclaw"
    app.state.ai_connected = True
    app.state.claude_code_status = "not_installed"
    app.state.claude_code_version = None
    app.state.codex_api = codex
    app.state.codex_api_status = "available"
    app.state.codex_cli = StubCodexCLI()
    app.state.codex_cli_status = "available"
    app.state.codex_cli_version = "codex-cli 0.test"
    try:
        yield codex
    finally:
        for key, value in previous.items():
            _restore_state(key, value)


async def test_provider_status_exposes_codex_metadata_without_credential(
    client, auth_headers, ai_provider_state
):
    response = await client.get("/api/admin/ai/provider", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_provider"] == "openclaw"
    assert payload["codex_api_status"] == "available"
    assert payload["codex_api_configured"] is True
    assert payload["codex_model"] == "gpt-5.3-codex"
    assert ai_provider_state.api_key not in response.text
    assert "api_key" not in payload
    assert payload["codex_cli_status"] == "available"
    assert payload["codex_cli_version"] == "codex-cli 0.test"


async def test_codex_cli_can_be_selected_as_the_active_provider(
    client, auth_headers, ai_provider_state
):
    response = await client.post(
        "/api/admin/ai/provider",
        headers=auth_headers,
        json={"provider": "codex_cli"},
    )

    assert response.status_code == 200
    assert response.json()["active_provider"] == "codex_cli"
    assert app.state.active_ai is app.state.codex_cli

    capabilities = await client.get("/api/capabilities", headers=auth_headers)
    assert capabilities.status_code == 200
    assert capabilities.json()["ai"] == {
        "provider": "codex_cli",
        "model": "Codex CLI default",
        "available": True,
    }


async def test_switching_provider_is_remembered_across_restarts(
    client, auth_headers, ai_provider_state, tmp_path, monkeypatch
):
    provider_file = tmp_path / "state" / "active-ai-provider"
    monkeypatch.setattr(settings, "ai_provider_file", str(provider_file))
    monkeypatch.setattr(settings, "ai_provider", "ollama")

    response = await client.post(
        "/api/admin/ai/provider",
        headers=auth_headers,
        json={"provider": "codex_cli"},
    )

    assert response.status_code == 200
    assert provider_file.read_text(encoding="utf-8") == "codex_cli"
    # A restart reads the file back through the Settings validator.
    assert Settings(ai_provider_file=str(provider_file)).ai_provider == "codex_cli"


async def test_switching_provider_survives_an_unwritable_data_directory(
    client, auth_headers, ai_provider_state, tmp_path, monkeypatch
):
    monkeypatch.setattr(
        settings, "ai_provider_file", str(tmp_path / "missing-file" / "provider")
    )
    monkeypatch.setattr(admin_module, "save_ai_provider", _explode)

    response = await client.post(
        "/api/admin/ai/provider",
        headers=auth_headers,
        json={"provider": "codex_cli"},
    )

    assert response.status_code == 200
    assert response.json()["active_provider"] == "codex_cli"


async def test_codex_can_be_selected_as_the_active_provider(
    client, auth_headers, ai_provider_state
):
    response = await client.post(
        "/api/admin/ai/provider",
        headers=auth_headers,
        json={"provider": "codex"},
    )

    assert response.status_code == 200
    assert response.json()["active_provider"] == "codex"
    assert app.state.active_ai is ai_provider_state

    capabilities = await client.get("/api/capabilities", headers=auth_headers)
    assert capabilities.status_code == 200
    assert capabilities.json()["ai"] == {
        "provider": "codex",
        "model": "gpt-5.3-codex",
        "available": True,
    }


async def test_configure_codex_validates_persists_and_activates_key(
    client,
    auth_headers,
    ai_provider_state,
    monkeypatch,
    tmp_path,
):
    key_path = tmp_path / "codex-api-key"
    new_key = "sk-new-key-that-is-long-enough-to-persist-safely"
    monkeypatch.setattr(settings, "codex_api_key_file", str(key_path))
    monkeypatch.setattr(settings, "codex_api_key", ai_provider_state.api_key)

    response = await client.put(
        "/api/admin/ai/codex",
        headers=auth_headers,
        json={"api_key": new_key},
    )

    assert response.status_code == 200
    assert response.json()["active_provider"] == "codex"
    assert response.json()["codex_api_key_persistent"] is True
    assert new_key not in response.text
    assert key_path.read_text(encoding="utf-8") == new_key
    assert ai_provider_state.api_key == new_key
    if os.name == "posix":
        assert stat.S_IMODE(key_path.stat().st_mode) == 0o600


async def test_rejected_codex_key_does_not_replace_current_credential(
    client,
    auth_headers,
    ai_provider_state,
    monkeypatch,
    tmp_path,
):
    original_key = ai_provider_state.api_key
    ai_provider_state.status = CodexAPIStatus.AUTHENTICATION_FAILED
    key_path = tmp_path / "codex-api-key"
    monkeypatch.setattr(settings, "codex_api_key_file", str(key_path))

    response = await client.put(
        "/api/admin/ai/codex",
        headers=auth_headers,
        json={"api_key": "sk-invalid-key-that-is-long-enough-for-validation"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "OpenAI rejected this API key."
    assert response.json()["error"]["details"]["reason"] == "codex_authentication_failed"
    assert ai_provider_state.api_key == original_key
    assert not key_path.exists()
