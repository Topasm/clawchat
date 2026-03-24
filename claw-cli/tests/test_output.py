"""Tests for output formatting — JSON mode, table rendering, edge cases."""

from __future__ import annotations

import json
from io import StringIO

import pytest
from rich.console import Console

from claw_cli import output


@pytest.fixture(autouse=True)
def _use_test_console(monkeypatch):
    """Replace the module-level Rich consoles with non-terminal versions."""
    test_console = Console(file=StringIO(), force_terminal=False)
    test_err = Console(file=StringIO(), stderr=True, force_terminal=False)
    monkeypatch.setattr(output, "console", test_console)
    monkeypatch.setattr(output, "err_console", test_err)


class TestJsonOutput:

    def test_print_json(self, capsys):
        output.print_json({"key": "value"})
        captured = capsys.readouterr()
        assert json.loads(captured.out) == {"key": "value"}

    def test_print_json_handles_datetime(self, capsys):
        from datetime import datetime
        output.print_json({"ts": datetime(2026, 1, 1, 12, 0)})
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert "2026" in data["ts"]


class TestTodoFormatting:

    def test_print_todo_row_basic(self):
        todo = {"id": "abc12345", "title": "Test", "status": "pending", "priority": "medium"}
        result = output.print_todo_row(todo)
        assert "Test" in result
        assert "abc1" in result  # truncated ID

    def test_print_todo_row_with_due(self):
        todo = {"id": "x" * 32, "title": "T", "status": "pending", "priority": "high", "due_date": "2026-04-01T00:00:00"}
        result = output.print_todo_row(todo)
        assert "2026-04-01" in result

    def test_print_todo_row_with_inbox_state(self):
        todo = {"id": "x" * 32, "title": "T", "status": "pending", "priority": "medium", "inbox_state": "plan_ready"}
        result = output.print_todo_row(todo)
        assert "plan ready" in result

    def test_print_todo_row_compact(self):
        todo = {"id": "abc12345", "title": "Test", "status": "pending", "priority": "medium"}
        result = output.print_todo_row(todo, compact=True)
        # compact mode omits ID
        assert "abc1" not in result

    def test_print_todo_list_empty(self):
        output.print_todo_list({"items": [], "total": 0})
        # No crash is success

    def test_print_todo_list_json_mode(self, capsys):
        data = {"items": [{"id": "1", "title": "T"}], "total": 1}
        output.print_todo_list(data, as_json=True)
        captured = capsys.readouterr()
        assert json.loads(captured.out)["total"] == 1

    def test_print_todo_list_plain_mode(self, capsys):
        data = {"items": [{"id": "abc12345", "title": "Test", "status": "pending"}], "total": 1}
        output.print_todo_list(data, plain=True)
        captured = capsys.readouterr()
        assert "abc12345" in captured.out
        assert "Test" in captured.out

    def test_print_todo_list_pagination_hint(self):
        """When total > items, a pagination hint is shown."""
        data = {"items": [{"id": "1", "title": "T", "status": "pending", "priority": "medium"}],
                "total": 50, "page": 1, "limit": 20}
        output.print_todo_list(data)
        # No crash; hint rendered to StringIO console


class TestTodayFormatting:

    def test_print_today_json(self, capsys):
        data = {"greeting": "Good morning", "date": "2026-03-24",
                "today_tasks": [], "overdue_tasks": [], "today_events": [],
                "needs_review": [], "inbox_count": 0}
        output.print_today(data, as_json=True)
        captured = capsys.readouterr()
        assert json.loads(captured.out)["greeting"] == "Good morning"

    def test_print_today_empty_day(self):
        data = {"greeting": "Hello", "date": "2026-03-24",
                "today_tasks": [], "overdue_tasks": [], "today_events": [],
                "needs_review": [], "inbox_count": 0}
        output.print_today(data)

    def test_print_today_all_sections(self):
        data = {
            "greeting": "Good evening",
            "date": "2026-03-24",
            "today_tasks": [{"id": "1", "title": "T1", "status": "pending", "priority": "medium"}],
            "overdue_tasks": [{"id": "2", "title": "Late", "status": "pending", "priority": "high"}],
            "today_events": [{"title": "Meeting", "start_time": "2026-03-24T14:00:00"}],
            "needs_review": [{"id": "3", "title": "Review", "status": "pending", "priority": "medium", "inbox_state": "plan_ready"}],
            "inbox_count": 3,
        }
        output.print_today(data)


class TestPlanFormatting:

    def test_print_plan_json(self, capsys):
        plan = {"task_id": "t1", "summary": "A plan", "subtasks": []}
        output.print_plan(plan, as_json=True)
        captured = capsys.readouterr()
        assert json.loads(captured.out)["summary"] == "A plan"

    def test_print_plan_with_subtasks(self):
        plan = {
            "task_id": "t1", "summary": "Plan summary",
            "subtasks": [
                {"title": "Step 1", "description": "Do X", "estimated_minutes": 30,
                 "due_date": "2026-04-01", "depends_on_indices": []},
                {"title": "Step 2", "description": None, "estimated_minutes": None,
                 "due_date": None, "depends_on_indices": [0]},
            ],
        }
        output.print_plan(plan)

    def test_print_plan_with_suggestions(self):
        plan = {
            "task_id": "t1", "summary": "S",
            "subtasks": [],
            "suggested_root_due_date": "2026-04-15",
            "suggested_skills_labels": ["research", "draft"],
            "suggested_project_label": "Backend",
        }
        output.print_plan(plan)


class TestSkillsFormatting:

    def test_print_skills_json(self, capsys):
        data = {"skills": [{"id": "plan", "name": "Plan", "description": "Break down", "tags": ["planning"]}]}
        output.print_skills(data, as_json=True)
        captured = capsys.readouterr()
        assert json.loads(captured.out)["skills"][0]["id"] == "plan"

    def test_print_skills_empty(self):
        output.print_skills({"skills": []})

    def test_print_skills_table(self):
        data = {"skills": [
            {"id": "plan", "name": "Plan", "description": "Break down tasks", "tags": ["planning"]},
            {"id": "research", "name": "Research", "description": "Investigate", "tags": ["analysis"]},
        ]}
        output.print_skills(data)


class TestErrorOutput:

    def test_print_error(self):
        output.print_error("something went wrong")
        # Rendered to stderr StringIO; no crash

    def test_print_success(self):
        output.print_success("done")
