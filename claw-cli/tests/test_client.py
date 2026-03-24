"""Tests for the API client — HTTP interactions, token refresh, error mapping."""

from __future__ import annotations

import json
import time
from unittest.mock import patch, MagicMock

import httpx
import pytest

from claw_cli import client, config
from claw_cli.errors import AuthError, ServerError, NotFoundError


@pytest.fixture(autouse=True)
def tmp_config(tmp_path, monkeypatch):
    """Redirect config to temp dir and pre-load valid auth."""
    cfg_dir = tmp_path / "claw"
    cfg_file = cfg_dir / "config.json"
    monkeypatch.setattr(config, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(config, "CONFIG_FILE", cfg_file)
    # Pre-load a valid session
    config.save_tokens(
        server_url="http://localhost:8000",
        access_token="valid_token",
        refresh_token="valid_refresh",
        expires_in=3600,
    )
    return cfg_file


class TestLogin:

    @patch("claw_cli.client.httpx.post")
    def test_login_success(self, mock_post):
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "access_token": "new_tok",
                "refresh_token": "new_ref",
                "token_type": "bearer",
                "expires_in": 86400,
            },
        )
        data = client.login("http://example.com", "123456")
        assert data["access_token"] == "new_tok"
        # Config should be updated
        assert config.get_access_token() == "new_tok"
        assert config.get_server_url() == "http://example.com"

    @patch("claw_cli.client.httpx.post")
    def test_login_wrong_pin(self, mock_post):
        mock_post.return_value = MagicMock(status_code=401)
        with pytest.raises(AuthError, match="Invalid PIN"):
            client.login("http://example.com", "wrong")

    @patch("claw_cli.client.httpx.post")
    def test_login_server_error(self, mock_post):
        mock_post.return_value = MagicMock(status_code=500)
        with pytest.raises(ServerError):
            client.login("http://example.com", "123")

    @patch("claw_cli.client.httpx.post")
    def test_login_network_error(self, mock_post):
        mock_post.side_effect = httpx.ConnectError("refused")
        with pytest.raises(ServerError, match="Cannot reach server"):
            client.login("http://example.com", "123")


class TestTokenRefresh:

    @patch("claw_cli.client.httpx.post")
    def test_refresh_on_expired_token(self, mock_post, tmp_config):
        # Set token as expired
        config.save({
            "server_url": "http://localhost:8000",
            "access_token": "expired_tok",
            "refresh_token": "valid_refresh",
            "token_expires_at": int(time.time()) - 100,
        })

        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "access_token": "refreshed_tok",
                "refresh_token": "refreshed_ref",
                "token_type": "bearer",
                "expires_in": 3600,
            },
        )

        token = client._ensure_auth()
        assert token == "refreshed_tok"
        assert config.get_access_token() == "refreshed_tok"

    @patch("claw_cli.client.httpx.post")
    def test_refresh_failure_clears_tokens(self, mock_post, tmp_config):
        config.save({
            "server_url": "http://localhost:8000",
            "access_token": "expired_tok",
            "refresh_token": "bad_refresh",
            "token_expires_at": int(time.time()) - 100,
        })

        mock_post.return_value = MagicMock(status_code=401)

        with pytest.raises(AuthError, match="Session expired"):
            client._ensure_auth()
        assert config.get_access_token() is None


class TestApiCalls:

    @patch("claw_cli.client.httpx.request")
    def test_todo_list(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=200,
            json=lambda: {"items": [{"id": "1", "title": "Test"}], "total": 1},
            request=MagicMock(method="GET"),
        )
        data = client.todo_list(status="pending", limit=10)
        assert data["items"][0]["title"] == "Test"
        # Check params were passed
        call_kwargs = mock_req.call_args
        assert call_kwargs.kwargs["params"]["status"] == "pending"

    @patch("claw_cli.client.httpx.request")
    def test_todo_create(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=201,
            json=lambda: {"id": "new-id", "title": "New todo"},
            request=MagicMock(method="POST"),
        )
        result = client.todo_create({"title": "New todo"})
        assert result["id"] == "new-id"

    @patch("claw_cli.client.httpx.request")
    def test_404_raises_not_found(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=404,
            request=MagicMock(method="GET", url="http://localhost:8000/api/todos/nope"),
        )
        with pytest.raises(NotFoundError):
            client.todo_get("nope")

    @patch("claw_cli.client.httpx.request")
    def test_422_raises_server_error(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=422,
            json=lambda: {"detail": "Validation failed"},
            request=MagicMock(method="POST"),
        )
        with pytest.raises(ServerError, match="Validation error"):
            client.todo_create({"title": ""})

    @patch("claw_cli.client.httpx.request")
    def test_network_error(self, mock_req):
        mock_req.side_effect = httpx.ConnectError("refused")
        with pytest.raises(ServerError, match="Cannot reach server"):
            client.today()

    @patch("claw_cli.client.httpx.request")
    def test_todo_update(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=200,
            json=lambda: {"id": "abc", "title": "Updated", "status": "completed"},
            request=MagicMock(method="PATCH"),
        )
        result = client.todo_update("abc", {"status": "completed"})
        assert result["status"] == "completed"

    @patch("claw_cli.client.httpx.request")
    def test_delegate(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=200,
            json=lambda: {"status": "queued", "task_id": "t1", "skill_id": "plan"},
            request=MagicMock(method="POST"),
        )
        result = client.delegate("abc", "plan")
        assert result["skill_id"] == "plan"

    @patch("claw_cli.client.httpx.request")
    def test_skills_list(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=200,
            json=lambda: {"skills": [{"id": "plan", "name": "Plan", "description": "...", "tags": []}]},
            request=MagicMock(method="GET"),
        )
        result = client.skills_list()
        assert len(result["skills"]) == 1

    @patch("claw_cli.client.httpx.request")
    def test_plan_apply(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=200,
            json=lambda: {"todo_id": "abc", "created_subtask_ids": ["s1", "s2"], "created_relationships": 1},
            request=MagicMock(method="POST"),
        )
        result = client.plan_apply("abc")
        assert len(result["created_subtask_ids"]) == 2


class TestLogout:

    @patch("claw_cli.client.httpx.request")
    def test_logout_clears_tokens(self, mock_req):
        mock_req.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": "Logged out"},
            request=MagicMock(method="POST"),
        )
        client.logout()
        assert config.get_access_token() is None

    @patch("claw_cli.client.httpx.request")
    def test_logout_ignores_server_error(self, mock_req):
        mock_req.side_effect = httpx.ConnectError("refused")
        # Should not raise
        client.logout()
        assert config.get_access_token() is None


class TestNoAuth:

    def test_no_login_raises_auth_error(self, tmp_path, monkeypatch):
        """Calling API without login raises AuthError."""
        cfg_dir = tmp_path / "empty"
        monkeypatch.setattr(config, "CONFIG_DIR", cfg_dir)
        monkeypatch.setattr(config, "CONFIG_FILE", cfg_dir / "config.json")

        with pytest.raises(AuthError, match="Not logged in"):
            client.today()
