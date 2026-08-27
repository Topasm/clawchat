"""Subprocess migration coverage for normalized task relationships."""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


_SERVER_ROOT = Path(__file__).resolve().parents[1]
_PREVIOUS_REVISION = "c5e936c9d7b1"


def _server_env(database_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": (
                f"sqlite+aiosqlite:///{database_path.resolve().as_posix()}"
            ),
            "JWT_SECRET": "task-relationship-migration-test-secret",
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


def _run_server_python(
    database_path: Path,
    code: str,
    *,
    succeeds: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_SERVER_ROOT,
        env=_server_env(database_path),
        capture_output=True,
        text=True,
        check=False,
    )
    if succeeds:
        assert result.returncode == 0, (
            "server subprocess failed\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    else:
        assert result.returncode != 0
    return result


def _run_init_db(
    database_path: Path,
    *,
    succeeds: bool = True,
) -> subprocess.CompletedProcess[str]:
    return _run_server_python(
        database_path,
        "import asyncio; from database import init_db; asyncio.run(init_db())",
        succeeds=succeeds,
    )


def _create_runtime_relationship_tables(database_path: Path) -> None:
    _run_server_python(
        database_path,
        """
import asyncio
from database import engine
from models import _register_all
from models.data_migration_marker import DataMigrationMarker
from models.task_relationship import TaskRelationship

async def main():
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda sync_connection: TaskRelationship.__table__.create(
                sync_connection, checkfirst=True
            )
        )
        await connection.run_sync(
            lambda sync_connection: DataMigrationMarker.__table__.create(
                sync_connection, checkfirst=True
            )
        )
    await engine.dispose()

asyncio.run(main())
""",
    )


def _insert_todos(
    database_path: Path,
    dependencies_by_id: dict[str, object],
) -> None:
    with sqlite3.connect(database_path) as connection:
        for todo_id, dependencies in dependencies_by_id.items():
            if dependencies is None:
                raw_dependencies = None
            elif isinstance(dependencies, str):
                raw_dependencies = dependencies
            else:
                raw_dependencies = json.dumps(dependencies)
            connection.execute(
                "INSERT INTO todos "
                "(id, title, status, priority, created_at, updated_at, "
                "sort_order, inbox_state, depends_on) "
                "VALUES (?, ?, 'pending', 'medium', CURRENT_TIMESTAMP, "
                "CURRENT_TIMESTAMP, 0, 'none', ?)",
                (todo_id, todo_id, raw_dependencies),
            )


def test_relationship_migration_backfills_and_restores_shadow(tmp_path: Path):
    database_path = tmp_path / "valid-relationships.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(
        database_path,
        {
            "todo_prerequisite": None,
            "todo_execute": ["todo_prerequisite"],
            "todo_review": ["todo_prerequisite", "todo_execute"],
        },
    )

    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        edges = connection.execute(
            "SELECT source_task_id, target_task_id, type, created_by "
            "FROM task_relationships ORDER BY created_at, id"
        ).fetchall()
        assert edges == [
            ("todo_execute", "todo_prerequisite", "depends_on", "legacy"),
            ("todo_review", "todo_prerequisite", "depends_on", "legacy"),
            ("todo_review", "todo_execute", "depends_on", "legacy"),
        ]
        assert connection.execute(
            "SELECT depends_on FROM todos WHERE id = 'todo_review'"
        ).fetchone() == ('["todo_prerequisite", "todo_execute"]',)
        assert connection.execute(
            "SELECT name FROM data_migration_markers"
        ).fetchone() == ("normalized_task_relationships_v1",)

        # Prove downgrade reconstructs the shadow from normalized rows rather
        # than relying on the retained legacy value.
        connection.execute("UPDATE todos SET depends_on = NULL")
        connection.commit()

    _run_alembic(database_path, "downgrade", _PREVIOUS_REVISION)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT depends_on FROM todos WHERE id = 'todo_execute'"
        ).fetchone() == ('["todo_prerequisite"]',)
        assert connection.execute(
            "SELECT depends_on FROM todos WHERE id = 'todo_review'"
        ).fetchone() == ('["todo_prerequisite", "todo_execute"]',)
        assert connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = 'task_relationships'"
        ).fetchone() is None
        assert connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = 'data_migration_markers'"
        ).fetchone() is None


def test_relationship_migration_handles_deep_legacy_dependency_chain(
    tmp_path: Path,
):
    database_path = tmp_path / "deep-relationships.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    chain_length = 1501
    dependencies = {
        f"todo_{index:04d}": (
            [f"todo_{index + 1:04d}"]
            if index + 1 < chain_length
            else None
        )
        for index in range(chain_length)
    }
    _insert_todos(database_path, dependencies)

    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM task_relationships"
        ).fetchone() == (chain_length - 1,)
        with pytest.raises(sqlite3.IntegrityError, match="dependency cycle detected"):
            connection.execute(
                "INSERT INTO task_relationships "
                "(id, source_task_id, target_task_id, type, created_by, "
                "created_at, updated_at) "
                "VALUES ('rel_deep_cycle', 'todo_1500', 'todo_0000', "
                "'depends_on', 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        connection.rollback()
        assert connection.execute(
            "SELECT COUNT(*) FROM task_relationships"
        ).fetchone() == (chain_length - 1,)


@pytest.mark.parametrize(
    ("dependencies_by_id", "expected_error"),
    [
        ({"todo_a": "{"}, "malformed depends_on JSON"),
        ({"todo_a": {"todo_b": True}}, "must be a JSON array"),
        ({"todo_a": [3]}, "must contain non-empty task IDs"),
        ({"todo_a": ["todo_a"]}, "cannot depend on itself"),
        ({"todo_a": ["todo_missing"]}, "references missing dependency"),
        (
            {"todo_a": ["todo_b", "todo_b"], "todo_b": None},
            "duplicate dependencies",
        ),
        (
            {"todo_a": ["todo_b"], "todo_b": ["todo_a"]},
            "Dependency cycle detected",
        ),
    ],
)
def test_relationship_migration_rejects_invalid_legacy_graph(
    tmp_path: Path,
    dependencies_by_id: dict[str, object],
    expected_error: str,
):
    database_path = tmp_path / "invalid-relationships.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(database_path, dependencies_by_id)

    result = _run_alembic(database_path, "upgrade", "head", succeeds=False)

    assert expected_error in result.stderr
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == (_PREVIOUS_REVISION,)
        assert connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = 'task_relationships'"
        ).fetchone() is None
        assert connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = 'data_migration_markers'"
        ).fetchone() is None


def test_relationship_migration_downgrade_fails_closed_for_non_dependency_edges(
    tmp_path: Path,
):
    database_path = tmp_path / "lossy-downgrade.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(database_path, {"todo_a": None, "todo_b": None})
    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO task_relationships "
            "(id, source_task_id, target_task_id, type, created_by, "
            "created_at, updated_at) "
            "VALUES ('rel_related', 'todo_a', 'todo_b', 'related', 'user', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )
        connection.commit()

    result = _run_alembic(
        database_path,
        "downgrade",
        _PREVIOUS_REVISION,
        succeeds=False,
    )
    assert "without losing relationship types: related" in result.stderr

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT type FROM task_relationships WHERE id = 'rel_related'"
        ).fetchone() == ("related",)
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == ("4d8f2a1c7b90",)


@pytest.mark.parametrize(
    ("created_by", "label", "proposal_id"),
    [
        ("user", None, None),
        ("ai", None, None),
        ("legacy", "migration rationale", None),
        ("legacy", None, "plan_unsafe"),
    ],
)
def test_relationship_migration_downgrade_fails_closed_for_dependency_metadata(
    tmp_path: Path,
    created_by: str,
    label: str | None,
    proposal_id: str | None,
):
    database_path = tmp_path / "dependency-metadata-downgrade.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(database_path, {"todo_a": None, "todo_b": None})
    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO task_relationships "
            "(id, source_task_id, target_task_id, type, label, created_by, "
            "proposal_id, created_at, updated_at) "
            "VALUES ('rel_metadata', 'todo_a', 'todo_b', 'depends_on', ?, ?, "
            "?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (label, created_by, proposal_id),
        )
        connection.commit()

    result = _run_alembic(
        database_path,
        "downgrade",
        _PREVIOUS_REVISION,
        succeeds=False,
    )
    assert "without losing provenance or metadata" in result.stderr

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT created_by, label, proposal_id FROM task_relationships "
            "WHERE id = 'rel_metadata'"
        ).fetchone() == (created_by, label, proposal_id)
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == ("4d8f2a1c7b90",)


def test_init_db_imports_legacy_once_then_uses_normalized_source_of_truth(
    tmp_path: Path,
):
    database_path = tmp_path / "init-db-source-of-truth.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(
        database_path,
        {
            "todo_prerequisite": None,
            "todo_execute": ["todo_prerequisite"],
        },
    )

    _run_init_db(database_path)
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT source_task_id, target_task_id FROM task_relationships"
        ).fetchone() == ("todo_execute", "todo_prerequisite")
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' "
            "AND name IN ("
            "'task_relationships_prevent_dependency_cycle_insert', "
            "'task_relationships_prevent_dependency_cycle_update')"
        ).fetchone() == (2,)
        connection.execute("DELETE FROM task_relationships")
        connection.commit()
        assert connection.execute(
            "SELECT depends_on FROM todos WHERE id = 'todo_execute'"
        ).fetchone() == ('["todo_prerequisite"]',)

    _run_init_db(database_path)
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM task_relationships"
        ).fetchone() == (0,)
        assert connection.execute(
            "SELECT depends_on FROM todos WHERE id = 'todo_execute'"
        ).fetchone() == (None,)


def test_init_db_recovers_partial_unmarked_relationship_import(tmp_path: Path):
    database_path = tmp_path / "partial-unmarked-import.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(
        database_path,
        {
            "todo_prerequisite": None,
            "todo_execute": ["todo_prerequisite"],
            "todo_review": ["todo_execute"],
        },
    )
    _create_runtime_relationship_tables(database_path)
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO task_relationships "
            "(id, source_task_id, target_task_id, type, created_by, "
            "created_at, updated_at) "
            "VALUES ('rel_partial', 'todo_execute', 'todo_prerequisite', "
            "'depends_on', 'legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )
        connection.commit()

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT source_task_id, target_task_id FROM task_relationships "
            "ORDER BY source_task_id, target_task_id"
        ).fetchall() == [
            ("todo_execute", "todo_prerequisite"),
            ("todo_review", "todo_execute"),
        ]
        assert connection.execute(
            "SELECT COUNT(*) FROM data_migration_markers "
            "WHERE name = 'normalized_task_relationships_v1'"
        ).fetchone() == (1,)


def test_init_db_repeatedly_fails_closed_when_marker_outlives_table(
    tmp_path: Path,
):
    database_path = tmp_path / "marker-without-table.db"
    _run_alembic(database_path, "upgrade", _PREVIOUS_REVISION)
    _insert_todos(
        database_path,
        {
            "todo_prerequisite": None,
            "todo_execute": ["todo_prerequisite"],
        },
    )
    _run_alembic(database_path, "upgrade", "head")
    with sqlite3.connect(database_path) as connection:
        connection.execute("DROP TABLE task_relationships")
        connection.commit()

    for _attempt in range(2):
        result = _run_init_db(database_path, succeeds=False)
        assert "migration marker exists" in result.stderr
        assert "task_relationships table is missing" in result.stderr
        with sqlite3.connect(database_path) as connection:
            assert connection.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'table' AND name = 'task_relationships'"
            ).fetchone() is None
            assert connection.execute(
                "SELECT depends_on FROM todos WHERE id = 'todo_execute'"
            ).fetchone() == ('["todo_prerequisite"]',)
            assert connection.execute(
                "SELECT name FROM data_migration_markers"
            ).fetchone() == ("normalized_task_relationships_v1",)
