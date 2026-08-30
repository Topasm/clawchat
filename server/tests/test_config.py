import os
import stat

import pytest

from config import _DEFAULT_JWT_SECRET, Settings, save_codex_api_key


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_jwt_secret_file_is_stable_across_settings_instances(tmp_path):
    secret_path = tmp_path / "credentials" / "server-jwt-secret"

    first = _settings(jwt_secret=_DEFAULT_JWT_SECRET, jwt_secret_file=str(secret_path))
    second = _settings(jwt_secret=_DEFAULT_JWT_SECRET, jwt_secret_file=str(secret_path))

    assert first.jwt_secret == second.jwt_secret
    assert first.jwt_secret != _DEFAULT_JWT_SECRET
    assert len(first.jwt_secret) >= 32
    assert secret_path.read_text(encoding="utf-8") == first.jwt_secret


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission bits only")
def test_jwt_secret_file_is_owner_only_on_posix(tmp_path):
    secret_path = tmp_path / "server-jwt-secret"

    _settings(jwt_secret=_DEFAULT_JWT_SECRET, jwt_secret_file=str(secret_path))

    assert stat.S_IMODE(secret_path.stat().st_mode) == 0o600


def test_jwt_secret_file_rejects_short_existing_value(tmp_path):
    secret_path = tmp_path / "server-jwt-secret"
    secret_path.write_text("too-short", encoding="utf-8")

    with pytest.raises(ValueError, match="empty or too short"):
        _settings(jwt_secret=_DEFAULT_JWT_SECRET, jwt_secret_file=str(secret_path))


def test_explicit_jwt_secret_does_not_touch_secret_file(tmp_path):
    secret_path = tmp_path / "server-jwt-secret"

    configured = _settings(
        jwt_secret="an-explicit-secret-that-is-long-enough",
        jwt_secret_file=str(secret_path),
    )

    assert configured.jwt_secret == "an-explicit-secret-that-is-long-enough"
    assert not secret_path.exists()


def test_codex_api_key_can_be_loaded_from_protected_file(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    secret_path = tmp_path / "credentials" / "codex-api-key"
    api_key = "sk-test-codex-key-that-is-long-enough-for-storage"
    save_codex_api_key(str(secret_path), api_key)

    configured = _settings(codex_api_key="", codex_api_key_file=str(secret_path))

    assert configured.codex_api_key == api_key


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission bits only")
def test_saved_codex_api_key_is_owner_only(tmp_path):
    secret_path = tmp_path / "codex-api-key"

    save_codex_api_key(
        str(secret_path),
        "sk-test-codex-key-that-is-long-enough-for-storage",
    )

    assert stat.S_IMODE(secret_path.stat().st_mode) == 0o600


def test_openai_api_key_is_a_codex_fallback(monkeypatch):
    monkeypatch.setenv(
        "OPENAI_API_KEY",
        "sk-test-openai-key-that-is-long-enough-for-fallback",
    )

    configured = _settings(codex_api_key="", codex_api_key_file="")

    assert configured.codex_api_key == (
        "sk-test-openai-key-that-is-long-enough-for-fallback"
    )


def test_codex_reasoning_effort_is_validated():
    with pytest.raises(ValueError, match="low, medium, high, xhigh"):
        _settings(codex_reasoning_effort="maximum")
