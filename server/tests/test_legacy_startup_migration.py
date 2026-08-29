"""Startup coverage for adopting databases that predate Alembic.

Every installation before this change built its schema from
``Base.metadata.create_all`` plus a hand-written correction list, so it has the
modern tables but no ``alembic_version`` row. Running ``upgrade head`` on such a
database without stamping it first would replay the baseline revision and abort
on "table already exists". These tests exercise the adoption path from every
point in the revision history and assert that no row is lost on the way to head.
"""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

_SERVER_ROOT = Path(__file__).resolve().parents[1]

_REVISION_CHAIN = (
    "9927ab512428",
    "c5e936c9d7b1",
    "4d8f2a1c7b90",
    "7a31c9e5d204",
    "1f6b9c4d2a70",
    "8c2d4e6f901b",
    "b7e3a19d4c52",
    "c4a8e2f91d30",
    "d6f8a1c3e520",
    "e2b7c4d81a35",
)
_HEAD_REVISION = "d1e94a7c3f28"

# The correction list exactly as the pre-Alembic startup path ran it. Frozen
# here on purpose: this test only means something if it reproduces the schema
# real installations actually have, so it must not follow future edits to
# ``database._LEGACY_BASELINE_CORRECTIONS``.
_HISTORICAL_CORRECTIONS = (
    "ALTER TABLE todos ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
    "ALTER TABLE todos ADD COLUMN parent_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
    "ALTER TABLE todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE todos ADD COLUMN source TEXT",
    "ALTER TABLE todos ADD COLUMN source_id TEXT",
    "ALTER TABLE todos ADD COLUMN assignee TEXT",
    "ALTER TABLE todos ADD COLUMN inbox_state TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE todos ADD COLUMN estimated_minutes INTEGER",
    "ALTER TABLE todos ADD COLUMN automation_error TEXT",
    "ALTER TABLE todos ADD COLUMN enabled_skills TEXT",
    "ALTER TABLE todos ADD COLUMN clarification_questions TEXT",
    "ALTER TABLE todos ADD COLUMN clarification_answers TEXT",
    "ALTER TABLE todos ADD COLUMN depends_on TEXT",
    "ALTER TABLE todos ADD COLUMN recurrence_rule TEXT",
    "ALTER TABLE todos ADD COLUMN recurrence_end DATETIME",
    "ALTER TABLE todos ADD COLUMN recurrence_exceptions TEXT",
    "ALTER TABLE todos ADD COLUMN recurring_source_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
    "ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
    "ALTER TABLE conversations ADD COLUMN project_todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
    "ALTER TABLE events ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
    "ALTER TABLE plan_proposals ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
    "ALTER TABLE agent_tasks ADD COLUMN todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
    "ALTER TABLE agent_tasks ADD COLUMN payload_json TEXT",
    "ALTER TABLE agent_tasks ADD COLUMN skill_chain TEXT",
    "ALTER TABLE agent_tasks ADD COLUMN current_skill_index INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN default_execution_model TEXT",
    "ALTER TABLE projects ADD COLUMN execution_workspace_path TEXT",
    "ALTER TABLE projects ADD COLUMN execution_workspace_isolation TEXT NOT NULL DEFAULT 'local'",
    "ALTER TABLE projects ADD COLUMN execution_base_branch TEXT",
    "ALTER TABLE agent_runs ADD COLUMN external_run_id TEXT",
    "ALTER TABLE paired_devices ADD COLUMN public_key TEXT",
    "ALTER TABLE messages ADD COLUMN idempotency_key TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_idempotency_key "
    "ON messages (conversation_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_todos_project_id ON todos(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_plan_proposals_project_status "
    "ON plan_proposals(project_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_agent_runs_external_run_id ON agent_runs(external_run_id)",
)

_LEGACY_BOOTSTRAP_SCRIPT = """
import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import Base, engine
from models import _register_all  # noqa: F401

CORRECTIONS = {corrections!r}


async def main():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as session:
        for statement in CORRECTIONS:
            try:
                await session.execute(text(statement))
            except Exception:
                pass
        await session.commit()
    await engine.dispose()


asyncio.run(main())
"""

_INIT_DB_SCRIPT = "import asyncio; from database import init_db; asyncio.run(init_db())"


def _server_env(database_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": (
                f"sqlite+aiosqlite:///{database_path.resolve().as_posix()}"
            ),
            "JWT_SECRET": "legacy-startup-migration-test-secret",
            "UPLOAD_DIR": str(database_path.parent / "uploads"),
        }
    )
    return env


def _run_server_python(
    database_path: Path,
    script: str,
    *,
    succeeds: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=_SERVER_ROOT,
        env=_server_env(database_path),
        capture_output=True,
        text=True,
        check=False,
    )
    if succeeds:
        assert result.returncode == 0, (
            f"server subprocess failed\nstdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    else:
        assert result.returncode != 0, (
            f"server subprocess unexpectedly succeeded\nstdout:\n{result.stdout}"
        )
    return result


def _run_init_db(
    database_path: Path,
    *,
    succeeds: bool = True,
) -> subprocess.CompletedProcess[str]:
    return _run_server_python(database_path, _INIT_DB_SCRIPT, succeeds=succeeds)


def _run_alembic(database_path: Path, *arguments: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=_SERVER_ROOT,
        env=_server_env(database_path),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"Alembic {' '.join(arguments)} failed\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def _bootstrap_legacy_database(database_path: Path) -> None:
    """Recreate the pre-Alembic startup path: create_all plus corrections."""
    _run_server_python(
        database_path,
        _LEGACY_BOOTSTRAP_SCRIPT.format(corrections=_HISTORICAL_CORRECTIONS),
    )


def _drop_version_table(database_path: Path) -> None:
    """Turn a migrated database back into a pre-Alembic one."""
    with sqlite3.connect(database_path) as connection:
        connection.execute("DROP TABLE alembic_version")
        connection.commit()


def _current_revision(database_path: Path) -> str | None:
    with sqlite3.connect(database_path) as connection:
        if not connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = 'alembic_version'"
        ).fetchone():
            return None
        row = connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone()
    return None if row is None else row[0]


def _schema_snapshot(database_path: Path) -> dict[str, set]:
    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
            if row[0] != "alembic_version"
        }
        return {
            table: {
                row[1] for row in connection.execute(f"PRAGMA table_info('{table}')")
            }
            for table in tables
        }


def _insert_todo(
    connection: sqlite3.Connection,
    todo_id: str,
    *,
    assignee: str | None = None,
    parent_id: str | None = None,
    status: str = "pending",
) -> None:
    connection.execute(
        "INSERT INTO todos "
        "(id, title, status, priority, created_at, updated_at, sort_order, "
        "inbox_state, assignee, parent_id) "
        "VALUES (?, ?, ?, 'medium', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, "
        "'none', ?, ?)",
        (todo_id, f"title-{todo_id}", status, assignee, parent_id),
    )


# ---------------------------------------------------------------------------
# Adoption from every point in the revision history
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("revision", _REVISION_CHAIN)
def test_unstamped_database_is_adopted_and_upgraded_from_any_revision(
    tmp_path: Path,
    revision: str,
):
    """A database whose schema stops at ``revision`` still reaches head.

    The ``alembic_version`` table is dropped to reproduce what a pre-Alembic
    installation looks like: the schema of some past release, and no record of
    which one.
    """
    database_path = tmp_path / f"unstamped-{revision}.db"
    _run_alembic(database_path, "upgrade", revision)
    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_root", assignee="planner")
        _insert_todo(connection, "todo_child", parent_id="todo_root")
        connection.commit()
    _drop_version_table(database_path)

    _run_init_db(database_path)

    assert _current_revision(database_path) == _HEAD_REVISION
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT id FROM todos ORDER BY id"
        ).fetchall() == [("todo_child",), ("todo_root",)]
        # The transform that used to live in ``_run_data_migrations`` is now
        # revision f0d5c8a12b64 and still reaches an adopted database.
        assert connection.execute(
            "SELECT enabled_skills FROM todos WHERE id = 'todo_root'"
        ).fetchone() == ('["plan"]',)


def test_adopted_database_ends_up_with_the_head_schema(tmp_path: Path):
    """Adoption must converge on the same schema a fresh install gets."""
    adopted = tmp_path / "adopted.db"
    fresh = tmp_path / "fresh.db"
    _run_alembic(adopted, "upgrade", _REVISION_CHAIN[0])
    _drop_version_table(adopted)

    _run_init_db(adopted)
    _run_alembic(fresh, "upgrade", "head")

    adopted_schema = _schema_snapshot(adopted)
    fresh_schema = _schema_snapshot(fresh)
    # ``init_db`` also installs the FTS5 objects, which Alembic does not own.
    fts_tables = {
        table for table in adopted_schema if "_fts" in table
    }
    for table in fts_tables:
        adopted_schema.pop(table)
    assert adopted_schema == fresh_schema


# ---------------------------------------------------------------------------
# Adoption of a real pre-Alembic (create_all + corrections) database
# ---------------------------------------------------------------------------


def test_create_all_database_is_adopted_without_losing_data(tmp_path: Path):
    database_path = tmp_path / "create-all-legacy.db"
    _bootstrap_legacy_database(database_path)
    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_root", assignee="researcher")
        _insert_todo(connection, "todo_child", parent_id="todo_root")
        connection.execute(
            "INSERT INTO conversations "
            "(id, title, created_at, updated_at, is_archived, project_todo_id) "
            "VALUES ('conv_1', 'Legacy chat', CURRENT_TIMESTAMP, "
            "CURRENT_TIMESTAMP, 0, 'todo_root')"
        )
        connection.commit()
    assert _current_revision(database_path) is None

    _run_init_db(database_path)

    assert _current_revision(database_path) == _HEAD_REVISION
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT id FROM todos ORDER BY id"
        ).fetchall() == [("todo_child",), ("todo_root",)]
        assert connection.execute(
            "SELECT enabled_skills FROM todos WHERE id = 'todo_root'"
        ).fetchone() == ('["research"]',)
        # The startup backfills still run for a legacy database: its tables
        # existed before any revision could have backfilled them.
        projects = connection.execute(
            "SELECT id, root_task_id FROM projects"
        ).fetchall()
        assert len(projects) == 1
        project_id, root_task_id = projects[0]
        assert root_task_id == "todo_root"
        assert connection.execute(
            "SELECT project_id FROM todos ORDER BY id"
        ).fetchall() == [(project_id,), (project_id,)]


def test_second_startup_of_an_adopted_database_changes_nothing(tmp_path: Path):
    database_path = tmp_path / "adoption-idempotent.db"
    _bootstrap_legacy_database(database_path)
    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_root", assignee="executor")
        _insert_todo(connection, "todo_child", parent_id="todo_root")
        connection.commit()

    _run_init_db(database_path)
    first = _schema_snapshot(database_path)
    with sqlite3.connect(database_path) as connection:
        project_rows = connection.execute(
            "SELECT id, root_task_id FROM projects ORDER BY id"
        ).fetchall()

    _run_init_db(database_path)

    assert _current_revision(database_path) == _HEAD_REVISION
    assert _schema_snapshot(database_path) == first
    with sqlite3.connect(database_path) as connection:
        # An idempotent backfill must not produce a second project on reboot.
        assert (
            connection.execute(
                "SELECT id, root_task_id FROM projects ORDER BY id"
            ).fetchall()
            == project_rows
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM todos"
        ).fetchone() == (2,)


# ---------------------------------------------------------------------------
# Fail-closed behaviour
# ---------------------------------------------------------------------------


def test_empty_database_is_migrated_without_stamping(tmp_path: Path):
    database_path = tmp_path / "fresh-install.db"

    _run_init_db(database_path)

    assert _current_revision(database_path) == _HEAD_REVISION


def test_detection_refuses_a_schema_that_is_not_a_revision_prefix(
    tmp_path: Path,
):
    """A hole in the middle of the history must abort, not get stamped over."""
    database_path = tmp_path / "non-prefix.db"
    _run_alembic(database_path, "upgrade", "head")
    with sqlite3.connect(database_path) as connection:
        # Removing the marker table first keeps the relationship guard out of
        # the way, so the failure that surfaces is the detection failure.
        connection.execute("DROP TABLE data_migration_markers")
        connection.execute("DROP TABLE task_relationships")
        connection.commit()
    _drop_version_table(database_path)

    result = _run_init_db(database_path, succeeds=False)

    assert "unrecognised pre-Alembic database" in result.stderr
    assert "contiguous prefix" in result.stderr
    assert _current_revision(database_path) is None


def test_detection_refuses_a_database_without_the_baseline_tables(
    tmp_path: Path,
):
    database_path = tmp_path / "not-clawchat.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)")
        connection.commit()

    result = _run_init_db(database_path, succeeds=False)

    assert "unrecognised pre-Alembic database" in result.stderr
    assert "baseline tables" in result.stderr
    assert _current_revision(database_path) is None


# ---------------------------------------------------------------------------
# The data transforms that moved out of ``_run_data_migrations``
# ---------------------------------------------------------------------------


def test_assignee_skill_defaults_migrate_once_and_do_not_overwrite(
    tmp_path: Path,
):
    database_path = tmp_path / "assignee-skills.db"
    _run_alembic(database_path, "upgrade", _REVISION_CHAIN[0])
    with sqlite3.connect(database_path) as connection:
        for assignee in ("planner", "researcher", "executor"):
            _insert_todo(connection, f"todo_{assignee}", assignee=assignee)
        connection.execute(
            "UPDATE todos SET enabled_skills = '[\"custom\"]' "
            "WHERE id = 'todo_planner'"
        )
        connection.commit()

    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        assert dict(
            connection.execute("SELECT id, enabled_skills FROM todos").fetchall()
        ) == {
            "todo_planner": '["custom"]',
            "todo_researcher": '["research"]',
            "todo_executor": '["obsidian_sync"]',
        }


def test_invalid_legacy_task_status_is_normalized_by_the_migration(
    tmp_path: Path,
):
    database_path = tmp_path / "legacy-status.db"
    _run_alembic(database_path, "upgrade", _REVISION_CHAIN[0])
    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_bad_status", status="archived")
        connection.execute(
            "UPDATE todos SET completed_at = CURRENT_TIMESTAMP "
            "WHERE id = 'todo_bad_status'"
        )
        connection.commit()
    _drop_version_table(database_path)

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT status, completed_at FROM todos WHERE id = 'todo_bad_status'"
        ).fetchone() == ("pending", None)
