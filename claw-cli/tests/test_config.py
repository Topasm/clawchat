"""Tests for config persistence — save/load/clear tokens."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from claw_cli import config


@pytest.fixture(autouse=True)
def tmp_config(tmp_path, monkeypatch):
    """Redirect config to a temp directory for every test."""
    cfg_dir = tmp_path / "claw"
    cfg_file = cfg_dir / "config.json"
    monkeypatch.setattr(config, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(config, "CONFIG_FILE", cfg_file)
    return cfg_file


class TestConfigPersistence:

    def test_load_empty(self):
        assert config.load() == {}

    def test_save_and_load(self):
        config.save({"server_url": "http://localhost:8000"})
        assert config.load()["server_url"] == "http://localhost:8000"

    def test_save_tokens(self):
        config.save_tokens(
            server_url="http://localhost:8000",
            access_token="tok_abc",
            refresh_token="ref_xyz",
            expires_in=3600,
        )
        cfg = config.load()
        assert cfg["server_url"] == "http://localhost:8000"
        assert cfg["access_token"] == "tok_abc"
        assert cfg["refresh_token"] == "ref_xyz"
        assert cfg["token_expires_at"] > time.time()

    def test_clear_tokens(self):
        config.save_tokens("http://x", "tok", "ref", 3600)
        config.clear_tokens()
        cfg = config.load()
        assert "access_token" not in cfg
        assert "refresh_token" not in cfg
        assert "token_expires_at" not in cfg
        # server_url should remain
        assert cfg["server_url"] == "http://x"

    def test_get_server_url(self):
        assert config.get_server_url() is None
        config.save({"server_url": "http://a"})
        assert config.get_server_url() == "http://a"

    def test_get_access_token(self):
        assert config.get_access_token() is None
        config.save({"access_token": "tok"})
        assert config.get_access_token() == "tok"

    def test_is_token_expired_no_token(self):
        assert config.is_token_expired() is True

    def test_is_token_expired_valid(self):
        config.save({"token_expires_at": int(time.time()) + 3600})
        assert config.is_token_expired() is False

    def test_is_token_expired_within_buffer(self):
        # Token expires in 20 seconds — within the 30s buffer
        config.save({"token_expires_at": int(time.time()) + 20})
        assert config.is_token_expired() is True

    def test_trailing_slash_stripped(self):
        config.save_tokens("http://localhost:8000/", "tok", "ref", 3600)
        assert config.load()["server_url"] == "http://localhost:8000"

    def test_config_creates_directory(self, tmp_config):
        # Directory doesn't exist yet
        tmp_config.parent.rmdir() if tmp_config.parent.exists() else None
        config.save({"test": True})
        assert tmp_config.exists()
