"""Subprocess migration coverage for durable versioned plan state."""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path


_SERVER_ROOT = Path(__file__).resolve().parents[1]
_PREVIOUS_REVISION = "4d8f2a1c7b90"
_NEW_TABLES = (
    "task_graph_states",
    "plan_proposals",
    "change_sets",
    "vault_sync_jobs",
)


def _server_env(database_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": (
                f"sqlite+aiosqlite:///{database_path.resolve().as_posix()}"
            ),
            "JWT_SECRET": "plan-proposal-migration-test-secret",
            "UPLOAD_DIR": str(database_path.parent / "uploads"),
        }
    )
    return env


def _run_alembic(
    database_path: Path,
    *arguments: str,
    succeeds: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=_SERVER_ROOT,
        env=_server_env(database_path),
        capture_output=True,
        text=True,
        check=False,
    )
    if succeeds:
        assert result.returncode == 0, (
            f"Alembic {' '.join(arguments)} failed\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    else:
        assert result.returncode != 0
    return result


def _insert_todos(connection: sqlite3.Connection, *todo_ids: str) -> None:
    for todo_id in todo_ids:
        connection.execute(
            "INSERT INTO todos "
            "(id, title, status, priority, created_at, updated_at, "
            "sort_order, inbox_state) "
            "VALUES (?, ?, 'pending', 'medium', CURRENT_TIMESTAMP, "
            "CURRENT_TIMESTAMP, 0, 'none')",
            (todo_id, todo_id),
        )


def _insert_agent_task(
    connection: sqlite3.Connection,
    *,
    task_id: str,
    todo_id: str,
    payload_json: str | None,
    task_type: str = "plan_todo",
    status: str = "completed",
) -> None:
    connection.execute(
        "INSERT INTO agent_tasks "
        "(id, task_type, instruction, status, agent_type, "
        "current_skill_index, progress, sub_task_count, "
        "completed_sub_tasks, todo_id, payload_json, created_at, "
        "completed_at) VALUES (?, ?, 'legacy plan', ?, 'planner', 0, "
        "100, 0, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        (task_id, task_type, status, todo_id, payload_json),
    )


def _insert_relationship(
    connection: sqlite3.Connection,
    *,
    relationship_id: str,
    source_task_id: str,
    target_task_id: str,
    relationship_type: str,
    proposal_id: str | None,
) -> None:
    connection.execute(
        "INSERT INTO task_relationships "
        "(id, source_task_id, target_task_id, type, created_by, "
        "proposal_id, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 'ai', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        (
            relationship_id,
            source_task_id,
            target_task_id,
            relationship_type,
            proposal_id,
        ),
    )


def _table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def _trigger_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger'"
        )
    }


def test_migration_backfills_legacy_proposals_and_tracks_graph_revision(
    tmp_path: Path,
):
    database_path = tmp_path / "legacy-plans.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    with sqlite3.connect(database_path) as connection:
        _insert_todos(connection, "todo_root", "todo_child", "todo_other")
        _insert_agent_task(
            connection,
            task_id="plan_applied",
            todo_id="todo_root",
            payload_json='{"subtasks": [{"title": "Applied"}]}',
        )
        _insert_agent_task(
            connection,
            task_id="plan_stale",
            todo_id="todo_root",
            payload_json='{"subtasks": [{"title": "Stale"}]}',
        )
        _insert_agent_task(
            connection,
            task_id="plan_failed",
            todo_id="todo_root",
            payload_json="{",
        )
        _insert_agent_task(
            connection,
            task_id="plan_queued",
            todo_id="todo_root",
            payload_json='{"subtasks": []}',
            status="queued",
        )
        _insert_relationship(
            connection,
            relationship_id="rel_legacy_plan",
            source_task_id="todo_child",
            target_task_id="todo_root",
            relationship_type="depends_on",
            proposal_id="plan_applied",
        )

    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        proposals = connection.execute(
            "SELECT id, agent_task_id, base_graph_revision, status, "
            "is_revertible, validation_json, applied_at "
            "FROM plan_proposals ORDER BY id"
        ).fetchall()
        assert [row[:5] for row in proposals] == [
            ("plan_applied", "plan_applied", None, "applied", 0),
            ("plan_failed", "plan_failed", None, "failed", 0),
            ("plan_stale", "plan_stale", None, "stale", 0),
        ]
        validation_by_id = {
            row[0]: json.loads(row[5]) for row in proposals
        }
        assert validation_by_id["plan_applied"]["reason"] == (
            "relationship_reference_without_change_set"
        )
        assert "error" in validation_by_id["plan_failed"]
        assert validation_by_id["plan_stale"]["reason"] == (
            "legacy_proposal_requires_regeneration"
        )
        assert proposals[0][6] is not None
        assert proposals[1][6] is None
        assert proposals[2][6] is None

        # Backfill happens before revision triggers are installed; migration
        # itself therefore preserves the defined initial revision.
        assert connection.execute(
            "SELECT scope_id, revision FROM task_graph_states"
        ).fetchall() == [("global", 0)]

        revision_trigger_names = {
            name
            for name in _trigger_names(connection)
            if "graph_revision" in name
        }
        assert revision_trigger_names == {
            "todos_bump_task_graph_revision_insert",
            "todos_bump_task_graph_revision_update",
            "todos_bump_task_graph_revision_delete",
            "task_relationships_bump_graph_revision_insert",
            "task_relationships_bump_graph_revision_update",
            "task_relationships_bump_graph_revision_delete",
        }
        relationship_foreign_tables = {
            row[2]
            for row in connection.execute(
                "PRAGMA foreign_key_list(task_relationships)"
            )
        }
        assert "plan_proposals" not in relationship_foreign_tables

        connection.execute(
            "INSERT INTO todos "
            "(id, title, status, priority, created_at, updated_at, "
            "sort_order, inbox_state) VALUES "
            "('todo_revision', 'Revision', 'pending', 'medium', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 'none')"
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (1,)

        connection.execute(
            "UPDATE todos SET inbox_state = 'accepted', "
            "automation_error = 'ignored', depends_on = '[]', "
            "updated_at = CURRENT_TIMESTAMP WHERE id = 'todo_revision'"
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (1,)

        connection.execute(
            "UPDATE todos SET description = description "
            "WHERE id = 'todo_revision'"
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (1,)

        connection.execute(
            "UPDATE todos SET description = 'semantic' "
            "WHERE id = 'todo_revision'"
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (2,)

        _insert_relationship(
            connection,
            relationship_id="rel_revision",
            source_task_id="todo_revision",
            target_task_id="todo_other",
            relationship_type="related",
            proposal_id=None,
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (3,)
        connection.execute(
            "UPDATE task_relationships SET label = 'changed' "
            "WHERE id = 'rel_revision'"
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (4,)
        connection.execute(
            "DELETE FROM task_relationships WHERE id = 'rel_revision'"
        )
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (5,)
        connection.execute("DELETE FROM todos WHERE id = 'todo_revision'")
        assert connection.execute(
            "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
        ).fetchone() == (6,)

    downgrade = _run_alembic(
        database_path,
        "downgrade",
        _PREVIOUS_REVISION,
        succeeds=False,
    )
    assert "plan proposal history: 3" in downgrade.stderr


def test_migration_rejects_unknown_or_ineligible_proposal_references_before_ddl(
    tmp_path: Path,
):
    database_path = tmp_path / "invalid-plan-references.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    with sqlite3.connect(database_path) as connection:
        _insert_todos(connection, "todo_a", "todo_b", "todo_c")
        _insert_agent_task(
            connection,
            task_id="plan_queued",
            todo_id="todo_a",
            payload_json='{"subtasks": []}',
            status="queued",
        )
        _insert_agent_task(
            connection,
            task_id="plan_wrong_type",
            todo_id="todo_a",
            payload_json='{"subtasks": []}',
            task_type="research",
        )
        _insert_relationship(
            connection,
            relationship_id="rel_missing",
            source_task_id="todo_a",
            target_task_id="todo_b",
            relationship_type="depends_on",
            proposal_id="plan_missing",
        )
        _insert_relationship(
            connection,
            relationship_id="rel_queued",
            source_task_id="todo_b",
            target_task_id="todo_c",
            relationship_type="related",
            proposal_id="plan_queued",
        )
        _insert_relationship(
            connection,
            relationship_id="rel_wrong_type",
            source_task_id="todo_c",
            target_task_id="todo_a",
            relationship_type="duplicate",
            proposal_id="plan_wrong_type",
        )

    result = _run_alembic(
        database_path,
        "upgrade",
        "head",
        succeeds=False,
    )
    assert (
        "do not point to completed plan_todo agent tasks: "
        "plan_missing, plan_queued, plan_wrong_type"
    ) in result.stderr
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == (_PREVIOUS_REVISION,)
        assert not set(_NEW_TABLES).intersection(_table_names(connection))


def test_clean_migration_can_downgrade_and_removes_revision_triggers(
    tmp_path: Path,
):
    database_path = tmp_path / "clean-downgrade.db"
    _run_alembic(database_path, "upgrade", "head")
    _run_alembic(database_path, "downgrade", _PREVIOUS_REVISION)

    with sqlite3.connect(database_path) as connection:
        assert not set(_NEW_TABLES).intersection(_table_names(connection))
        assert not {
            name for name in _trigger_names(connection) if "graph_revision" in name
        }
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == (_PREVIOUS_REVISION,)


def test_downgrade_fails_closed_for_undelivered_vault_jobs(tmp_path: Path):
    database_path = tmp_path / "pending-outbox.db"
    _run_alembic(database_path, "upgrade", "head")
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO vault_sync_jobs "
            "(id, event_type, aggregate_id, dedupe_key, status, available_at, "
            "created_at, updated_at) VALUES "
            "('vault_pending', 'todo.upsert', 'todo', 'todo:1', 'pending', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )

    result = _run_alembic(
        database_path,
        "downgrade",
        _PREVIOUS_REVISION,
        succeeds=False,
    )
    assert "pending or failed vault sync jobs: 1" in result.stderr


def test_downgrade_fails_closed_for_non_reverted_change_set(tmp_path: Path):
    database_path = tmp_path / "applied-history.db"
    _run_alembic(database_path, "upgrade", "head")
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO plan_proposals "
            "(id, status, is_revertible, created_at, updated_at) VALUES "
            "('proposal_applied', 'applied', 1, CURRENT_TIMESTAMP, "
            "CURRENT_TIMESTAMP)"
        )
        connection.execute(
            "INSERT INTO change_sets "
            "(id, proposal_id, request_hash, base_graph_revision, status, "
            "created_at, updated_at) VALUES "
            "('changeset_applied', 'proposal_applied', 'hash', 0, 'applied', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )

    result = _run_alembic(
        database_path,
        "downgrade",
        _PREVIOUS_REVISION,
        succeeds=False,
    )
    assert "non-reverted change-set history: 1" in result.stderr
