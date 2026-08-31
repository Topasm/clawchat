from config import settings
from services.ai.claude_code_provider import ClaudeCodeStatus
from services.ai.codex_api_provider import CodexAPIStatus
from services.ai.codex_cli_provider import CodexCLIStatus
from services.lifecycle import configure_ai_state, probe_optional_ai
from starlette.datastructures import State


class StubAIService:
    async def health_check(self) -> bool:
        return True


class StubClaudeCode:
    async def check_availability(self):
        return ClaudeCodeStatus.NOT_INSTALLED, None


class StubCodexAPI:
    model = "gpt-test"

    def __init__(self, api_key: str = "test-key"):
        self.api_key = api_key

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def check_availability(self):
        return CodexAPIStatus.AVAILABLE


class StubCodexCLI:
    async def check_availability(self):
        return CodexCLIStatus.AVAILABLE, "codex-cli test"


def configured_state(*, codex_api=None):
    state = State()
    providers = {
        "ai_service": StubAIService(),
        "claude_code": StubClaudeCode(),
        "codex_api": codex_api or StubCodexAPI(),
        "codex_cli": StubCodexCLI(),
    }
    configure_ai_state(state, **providers)
    return state, providers


def test_configure_ai_state_exposes_safe_fallback_before_probes_finish():
    state, providers = configured_state()

    assert state.active_ai is providers["ai_service"]
    assert state.active_ai_provider == "openclaw"
    assert state.ai_connected is False
    assert state.claude_code_status == "checking"
    assert state.codex_api_status == "checking"
    assert state.codex_cli_status == "checking"


async def test_probe_selects_available_configured_provider(monkeypatch):
    state, providers = configured_state()
    monkeypatch.setattr(settings, "ai_provider", "codex_cli")

    await probe_optional_ai(state, **providers)

    assert state.ai_connected is True
    assert state.active_ai is providers["codex_cli"]
    assert state.active_ai_provider == "codex_cli"
    assert state.claude_code_status == "not_installed"
    assert state.codex_api_status == "available"
    assert state.codex_cli_status == "available"
    assert state.codex_cli_version == "codex-cli test"


async def test_probe_does_not_apply_result_for_replaced_codex_credential(monkeypatch):
    class CredentialChangingCodex(StubCodexAPI):
        async def check_availability(self):
            self.api_key = "replacement-key"
            return CodexAPIStatus.AVAILABLE

    state, providers = configured_state(codex_api=CredentialChangingCodex())
    monkeypatch.setattr(settings, "ai_provider", "codex")

    await probe_optional_ai(state, **providers)

    assert state.codex_api_status == "checking"
    assert state.active_ai is providers["ai_service"]
    assert state.active_ai_provider == "openclaw"
