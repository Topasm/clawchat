import os
import stat

import pytest

from config import _DEFAULT_JWT_SECRET, Settings


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
