"""End-to-end Alembic regression coverage for canonical task statuses."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


_SERVER_ROOT = Path(__file__).resolve().parents[1]
_BASELINE_REVISION = "9927ab512428"


def _run_alembic(database_path: Path, *arguments: str) -> None:
    env = os.environ.copy()
    database_url = f"sqlite+aiosqlite:///{database_path.resolve().as_posix()}"
    env.update(
        {
            "DATABASE_URL": database_url,
            "JWT_SECRET": "todo-status-migration-test-secret",
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=_SERVER_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"Alembic {' '.join(arguments)} failed\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )


def _insert_todo(connection: sqlite3.Connection, todo_id: str, status: str) -> None:
    connection.execute(
        "INSERT INTO todos "
        "(id, title, status, priority, created_at, updated_at, sort_order, inbox_state) "
        "VALUES (?, ?, ?, 'medium', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 'none')",
        (todo_id, todo_id, status),
    )


def test_task_status_migration_upgrade_and_downgrade(tmp_path: Path):
    database_path = tmp_path / "task-status-migration.db"
    _run_alembic(database_path, "upgrade", _BASELINE_REVISION)

    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_legacy", "custom")

    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        migrated = connection.execute(
            "SELECT status, completed_at FROM todos WHERE id = 'todo_legacy'"
        ).fetchone()
        assert migrated == ("pending", None)

        with pytest.raises(sqlite3.IntegrityError, match="ck_todos_status_valid"):
            _insert_todo(connection, "todo_invalid", "custom")
        connection.rollback()

    _run_alembic(database_path, "downgrade", _BASELINE_REVISION)

    with sqlite3.connect(database_path) as connection:
        preserved = connection.execute(
            "SELECT status FROM todos WHERE id = 'todo_legacy'"
        ).fetchone()
        assert preserved == ("pending",)

        _insert_todo(connection, "todo_after_downgrade", "custom")
        connection.commit()
        assert connection.execute(
            "SELECT status FROM todos WHERE id = 'todo_after_downgrade'"
        ).fetchone() == ("custom",)

        table_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
        ).fetchone()[0]
        assert "ck_todos_status_valid" not in table_sql
