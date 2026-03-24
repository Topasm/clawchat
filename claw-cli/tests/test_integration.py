"""Integration test: full flow with mock HTTP server.

Simulates: auth login → add --capture → inbox → plan → plan apply → done
"""

from __future__ import annotations

import json
import time
from unittest.mock import patch, MagicMock

import httpx
import pytest

from claw_cli import config
from claw_cli.cli import main
from claw_cli.errors import EXIT_OK


@pytest.fixture(autouse=True)
def tmp_config(tmp_path, monkeypatch):
    cfg_dir = tmp_path / "claw"
    cfg_file = cfg_dir / "config.json"
    monkeypatch.setattr(config, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(config, "CONFIG_FILE", cfg_file)
    return cfg_file


def _mock_response(status_code: int = 200, data: dict | None = None, method: str = "GET"):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=data or {})
    resp.text = json.dumps(data or {})
    resp.request = MagicMock(method=method, url="http://localhost:8000/api/test", content=b"")
    return resp


class TestFullFlow:
    """End-to-end flow: login → add → inbox → plan → apply → done."""

    def _run(self, argv: list[str]) -> int:
        """Run CLI and return exit code without actually exiting."""
        try:
            main(argv)
        except SystemExit as e:
            return e.code
        return 0

    @patch("claw_cli.client.httpx.post")
    def test_step1_login(self, mock_post):
        mock_post.return_value = _mock_response(200, {
            "access_token": "tok_abc",
            "refresh_token": "ref_xyz",
            "token_type": "bearer",
            "expires_in": 86400,
        })

        code = self._run(["auth", "login", "--server", "http://localhost:8000", "--pin", "123456"])
        assert code == EXIT_OK
        assert config.get_access_token() == "tok_abc"

    @patch("claw_cli.client.httpx.request")
    @patch("claw_cli.client.httpx.post")
    def test_step2_add_capture(self, mock_post, mock_req):
        # Login first
        mock_post.return_value = _mock_response(200, {
            "access_token": "tok", "refresh_token": "ref", "token_type": "bearer", "expires_in": 86400,
        })
        self._run(["auth", "login", "--server", "http://localhost:8000", "--pin", "123456"])

        # Add with capture
        mock_req.return_value = _mock_response(201, {
            "id": "todo-001",
            "title": "API Review",
            "status": "pending",
            "priority": "high",
            "inbox_state": "classifying",
        }, method="POST")

        code = self._run(["add", "API Review", "-p", "high", "--capture"])
        assert code == EXIT_OK

    @patch("claw_cli.client.httpx.request")
    @patch("claw_cli.client.httpx.post")
    def test_step3_inbox(self, mock_post, mock_req):
        # Login
        mock_post.return_value = _mock_response(200, {
            "access_token": "tok", "refresh_token": "ref", "token_type": "bearer", "expires_in": 86400,
        })
        self._run(["auth", "login", "--server", "http://localhost:8000", "--pin", "123456"])

        # Inbox
        mock_req.return_value = _mock_response(200, {
            "greeting": "Good morning",
            "date": "2026-03-24",
            "today_tasks": [],
            "overdue_tasks": [],
            "today_events": [],
            "needs_review": [
                {"id": "todo-001", "title": "API Review", "status": "pending",
                 "priority": "high", "inbox_state": "plan_ready"},
            ],
            "inbox_count": 1,
        })

        code = self._run(["inbox", "--json"])
        assert code == EXIT_OK

    @patch("claw_cli.client.httpx.request")
    @patch("claw_cli.client.httpx.post")
    def test_step4_plan_apply(self, mock_post, mock_req):
        # Login
        mock_post.return_value = _mock_response(200, {
            "access_token": "tok", "refresh_token": "ref", "token_type": "bearer", "expires_in": 86400,
        })
        self._run(["auth", "login", "--server", "http://localhost:8000", "--pin", "123456"])

        # Plan apply
        mock_req.return_value = _mock_response(200, {
            "todo_id": "todo-001",
            "created_subtask_ids": ["sub-1", "sub-2"],
            "created_relationships": 1,
            "project_folder_created": None,
        }, method="POST")

        code = self._run(["plan", "apply", "todo-001"])
        assert code == EXIT_OK

    @patch("claw_cli.client.httpx.request")
    @patch("claw_cli.client.httpx.post")
    def test_step5_done(self, mock_post, mock_req):
        # Login
        mock_post.return_value = _mock_response(200, {
            "access_token": "tok", "refresh_token": "ref", "token_type": "bearer", "expires_in": 86400,
        })
        self._run(["auth", "login", "--server", "http://localhost:8000", "--pin", "123456"])

        # Done
        mock_req.return_value = _mock_response(200, {
            "id": "todo-001", "title": "API Review", "status": "completed",
        }, method="PATCH")

        code = self._run(["done", "todo-001"])
        assert code == EXIT_OK
