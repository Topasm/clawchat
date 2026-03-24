"""Tests for argument parsing, command routing, and exit codes."""

from __future__ import annotations

import json
import sys
from io import StringIO
from unittest.mock import patch, MagicMock

import pytest

from claw_cli.cli import build_parser, main
from claw_cli.errors import (
    EXIT_OK, EXIT_INPUT_ERROR, EXIT_AUTH_ERROR, EXIT_SERVER_ERROR, EXIT_NOT_FOUND,
    AuthError, ServerError, NotFoundError, InputError,
)


class TestArgParsing:
    """Verify argparse produces correct Namespace for each command."""

    def setup_method(self):
        self.parser = build_parser()

    def test_auth_login(self):
        args = self.parser.parse_args(["auth", "login", "--server", "http://localhost:8000", "--pin", "1234"])
        assert args.server == "http://localhost:8000"
        assert args.pin == "1234"

    def test_auth_login_requires_server(self):
        with pytest.raises(SystemExit):
            self.parser.parse_args(["auth", "login"])

    def test_auth_status(self):
        args = self.parser.parse_args(["auth", "status"])
        assert args.auth_command == "status"

    def test_auth_logout(self):
        args = self.parser.parse_args(["auth", "logout"])
        assert args.auth_command == "logout"

    def test_add_minimal(self):
        args = self.parser.parse_args(["add", "Buy milk"])
        assert args.title == "Buy milk"
        assert args.priority is None
        assert args.capture is False

    def test_add_full(self):
        args = self.parser.parse_args([
            "add", "API Review",
            "-d", "Review the REST endpoints",
            "-p", "high",
            "--due", "2026-04-01",
            "--project", "backend",
            "-t", "api", "-t", "review",
            "--estimate", "60",
            "--capture",
        ])
        assert args.title == "API Review"
        assert args.description == "Review the REST endpoints"
        assert args.priority == "high"
        assert args.due == "2026-04-01"
        assert args.project == "backend"
        assert args.tag == ["api", "review"]
        assert args.estimate == 60
        assert args.capture is True

    def test_add_invalid_priority(self):
        with pytest.raises(SystemExit):
            self.parser.parse_args(["add", "Test", "-p", "critical"])

    def test_list_defaults(self):
        args = self.parser.parse_args(["list"])
        assert args.limit == 20
        assert args.page == 1
        assert args.json is False
        assert args.plain is False

    def test_list_with_filters(self):
        args = self.parser.parse_args([
            "list", "--status", "pending", "--priority", "high",
            "--root-only", "--limit", "5", "--page", "2", "--json",
        ])
        assert args.status == "pending"
        assert args.priority == "high"
        assert args.root_only is True
        assert args.limit == 5
        assert args.page == 2
        assert args.json is True

    def test_today(self):
        args = self.parser.parse_args(["today"])
        assert args.json is False

    def test_today_json(self):
        args = self.parser.parse_args(["today", "--json"])
        assert args.json is True

    def test_show(self):
        args = self.parser.parse_args(["show", "abc123"])
        assert args.todo_id == "abc123"

    def test_done(self):
        args = self.parser.parse_args(["done", "abc123"])
        assert args.todo_id == "abc123"

    def test_inbox_no_subcommand(self):
        args = self.parser.parse_args(["inbox"])
        assert args.inbox_command is None

    def test_inbox_organize(self):
        args = self.parser.parse_args(["inbox", "organize", "abc123"])
        assert args.todo_id == "abc123"

    def test_inbox_answer(self):
        args = self.parser.parse_args(["inbox", "answer", "abc123", "-a", "0=yes", "-a", "1=no"])
        assert args.todo_id == "abc123"
        assert args.answer == ["0=yes", "1=no"]

    def test_inbox_skip(self):
        args = self.parser.parse_args(["inbox", "skip", "abc123"])
        assert args.todo_id == "abc123"

    def test_plan_generate(self):
        args = self.parser.parse_args(["plan", "abc123"])
        assert args.action_or_id == "abc123"
        assert args.todo_id is None

    def test_plan_apply(self):
        args = self.parser.parse_args(["plan", "apply", "abc123"])
        assert args.action_or_id == "apply"
        assert args.todo_id == "abc123"

    def test_plan_dismiss(self):
        args = self.parser.parse_args(["plan", "dismiss", "abc123"])
        assert args.action_or_id == "dismiss"
        assert args.todo_id == "abc123"

    def test_delegate(self):
        args = self.parser.parse_args(["delegate", "abc123", "--skill", "research"])
        assert args.todo_id == "abc123"
        assert args.skill == "research"

    def test_delegate_requires_skill(self):
        with pytest.raises(SystemExit):
            self.parser.parse_args(["delegate", "abc123"])

    def test_skills(self):
        args = self.parser.parse_args(["skills"])
        assert args.json is False

    def test_skills_json(self):
        args = self.parser.parse_args(["skills", "--json"])
        assert args.json is True

    def test_version(self):
        with pytest.raises(SystemExit) as exc_info:
            self.parser.parse_args(["--version"])
        assert exc_info.value.code == 0


class TestExitCodes:
    """Verify error types map to correct exit codes."""

    def test_auth_error_code(self):
        assert AuthError("test").exit_code == EXIT_AUTH_ERROR

    def test_server_error_code(self):
        assert ServerError("test").exit_code == EXIT_SERVER_ERROR

    def test_not_found_error_code(self):
        assert NotFoundError("test").exit_code == EXIT_NOT_FOUND

    def test_input_error_code(self):
        assert InputError("test").exit_code == EXIT_INPUT_ERROR

    @patch("claw_cli.cli.client")
    def test_main_exits_with_error_code(self, mock_client):
        mock_client.todo_get.side_effect = NotFoundError("not found")
        with pytest.raises(SystemExit) as exc_info:
            main(["show", "nonexistent"])
        assert exc_info.value.code == EXIT_NOT_FOUND

    @patch("claw_cli.cli.client")
    def test_main_exits_ok_on_success(self, mock_client):
        mock_client.today.return_value = {
            "greeting": "Hello",
            "date": "2026-03-24",
            "today_tasks": [],
            "overdue_tasks": [],
            "today_events": [],
            "needs_review": [],
            "inbox_count": 0,
        }
        with pytest.raises(SystemExit) as exc_info:
            main(["today", "--json"])
        assert exc_info.value.code == EXIT_OK

    def test_no_command_shows_help(self):
        with pytest.raises(SystemExit) as exc_info:
            main([])
        assert exc_info.value.code == EXIT_INPUT_ERROR
