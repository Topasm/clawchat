"""A database that cannot take ``ck_todos_status_valid`` still gets enforced.

``c5e936c9d7b1`` adds the CHECK constraint by rebuilding ``todos``.  Pre-Alembic
installations are stamped *past* that revision on adoption -- its probe in
``database.py`` is deliberately aliased to the baseline probe -- so they never
run it and never receive the constraint.  Rebuilding ``todos`` to close the gap
is not available to a revision: ``database.py`` registers a global ``connect``
listener that enables ``PRAGMA foreign_keys`` for every engine including
Alembic's, and the pragma cannot be turned back off from inside Alembic's
transaction (SQLite documents it as a no-op there, and it silently reports
success).  ``DROP TABLE todos`` would then cascade every ``task_relationships``
and ``attachments`` row away and null every SET NULL link into ``todos``.

Revision ``a3f1c72b8d94`` therefore enforces the same domain with triggers,
which need no rewrite.  This module proves both halves: nothing is lost, and
invalid statuses are rejected by the database rather than only by the ORM.
"""

import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

_SERVER_ROOT = Path(__file__).resolve().parents[1]

#: The revision a pre-Alembic database gets stamped at -- past c5e936c9d7b1.
_ADOPTION_REVISION = "e2b7c4d81a35"
_HEAD_REVISION = "a1c3e5f7b902"
_BASELINE_REVISION = "9927ab512428"
# The revision just below a3f1c72b8d94, which installs the status triggers.
# Named rather than reached with "-1" so a later head does not silently
# retarget this file's downgrade test at some other revision.
_BELOW_TRIGGER_REVISION = "f0d5c8a12b64"

_INVALID_STATUS_MESSAGE = "ck_todos_status_valid"


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


def _server_env(database_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": (
                f"sqlite+aiosqlite:///{database_path.resolve().as_posix()}"
            ),
            "JWT_SECRET": "legacy-status-enforcement-test-secret",
            "UPLOAD_DIR": str(database_path.parent / "uploads"),
        }
    )
    return env


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


def _run_init_db(database_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import asyncio; from database import init_db; asyncio.run(init_db())",
        ],
        cwd=_SERVER_ROOT,
        env=_server_env(database_path),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"init_db failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def _strip_status_check_constraint(database_path: Path) -> None:
    """Reproduce a ``todos`` table built before the CHECK constraint existed.

    Real pre-Alembic databases were built by ``Base.metadata.create_all`` from a
    model that had no ``ck_todos_status_valid`` yet -- today's model has it, so
    the constraint has to be removed here to get that schema back.

    This is the rewrite the migration refuses to do, done where it *is* safe:
    a plain connection outside any transaction, where ``PRAGMA
    foreign_keys=OFF`` actually takes effect.  ``PRAGMA foreign_key_check``
    confirms nothing was orphaned.
    """
    connection = sqlite3.connect(database_path)
    connection.isolation_level = None
    try:
        create_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
        ).fetchone()[0]
        assert "ck_todos_status_valid" in create_sql
        stripped = re.sub(
            r"\s*CONSTRAINT ck_todos_status_valid CHECK \([^)]*\)\),?",
            "",
            create_sql,
        )
        assert "ck_todos_status_valid" not in stripped, stripped
        stripped = stripped.replace('CREATE TABLE "todos"', "CREATE TABLE todos_old", 1)

        indexes = [
            sql
            for (sql,) in connection.execute(
                "SELECT sql FROM sqlite_master "
                "WHERE type = 'index' AND tbl_name = 'todos' AND sql IS NOT NULL"
            )
        ]
        columns = ", ".join(
            row[1] for row in connection.execute("PRAGMA table_info('todos')")
        )

        connection.execute("PRAGMA foreign_keys=OFF")
        # ``task_relationships`` carries triggers that name ``todos``; with the
        # modern ALTER TABLE behaviour SQLite revalidates every trigger during
        # the rename and aborts because ``todos`` does not exist between the
        # DROP and the RENAME. One more thing a ``todos`` rebuild has to know
        # about, and one more reason the migration does not attempt it.
        connection.execute("PRAGMA legacy_alter_table=ON")
        connection.execute("BEGIN")
        connection.execute(stripped)
        connection.execute(f"INSERT INTO todos_old ({columns}) SELECT {columns} FROM todos")
        connection.execute("DROP TABLE todos")
        connection.execute("ALTER TABLE todos_old RENAME TO todos")
        for index_sql in indexes:
            connection.execute(index_sql)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        connection.execute("COMMIT")
        connection.execute("PRAGMA legacy_alter_table=OFF")
        connection.execute("PRAGMA foreign_keys=ON")
    finally:
        connection.close()


def _seed_related_rows(connection: sqlite3.Connection) -> None:
    """Every kind of row a ``todos`` rebuild would destroy."""
    connection.execute("PRAGMA foreign_keys=ON")
    for todo_id in ("todo_root", "todo_child", "todo_blocker"):
        connection.execute(
            "INSERT INTO todos "
            "(id, title, status, priority, created_at, updated_at, sort_order, "
            "inbox_state) VALUES (?, ?, 'pending', 'medium', CURRENT_TIMESTAMP, "
            "CURRENT_TIMESTAMP, 0, 'none')",
            (todo_id, f"title-{todo_id}"),
        )
    # ON DELETE SET NULL link inside todos itself.
    connection.execute(
        "UPDATE todos SET parent_id = 'todo_root' WHERE id = 'todo_child'"
    )
    # ON DELETE CASCADE rows in task_relationships.
    for rel_id, source, target in (
        ("rel_1", "todo_child", "todo_blocker"),
        ("rel_2", "todo_root", "todo_blocker"),
    ):
        connection.execute(
            "INSERT INTO task_relationships "
            "(id, source_task_id, target_task_id, type, created_by, created_at, "
            "updated_at) VALUES (?, ?, ?, 'depends_on', 'user', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (rel_id, source, target),
        )
    # ON DELETE CASCADE rows in attachments.
    connection.execute(
        "INSERT INTO attachments "
        "(id, filename, stored_filename, content_type, size_bytes, todo_id, "
        "created_at) VALUES ('att_1', 'notes.md', 'stored-notes.md', "
        "'text/markdown', 10, 'todo_root', CURRENT_TIMESTAMP)"
    )
    # ON DELETE SET NULL link from another table.
    connection.execute(
        "INSERT INTO conversations "
        "(id, title, created_at, updated_at, is_archived, project_todo_id) "
        "VALUES ('conv_1', 'Legacy chat', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "
        "0, 'todo_root')"
    )
    connection.commit()


def _make_legacy_database(tmp_path: Path, name: str) -> Path:
    """A database in the exact shape adoption has to handle.

    All the modern tables, no ``alembic_version`` row, and no CHECK constraint
    on ``todos``.
    """
    database_path = tmp_path / name
    _run_alembic(database_path, "upgrade", _ADOPTION_REVISION)
    with sqlite3.connect(database_path) as connection:
        _seed_related_rows(connection)
    _strip_status_check_constraint(database_path)
    with sqlite3.connect(database_path) as connection:
        connection.execute("DROP TABLE alembic_version")
        connection.commit()
    return database_path


def _insert_todo(connection: sqlite3.Connection, todo_id: str, status: str) -> None:
    connection.execute(
        "INSERT INTO todos "
        "(id, title, status, priority, created_at, updated_at, sort_order, "
        "inbox_state) VALUES (?, ?, ?, 'medium', CURRENT_TIMESTAMP, "
        "CURRENT_TIMESTAMP, 0, 'none')",
        (todo_id, todo_id, status),
    )


def _relationship_rows(connection: sqlite3.Connection) -> list[tuple]:
    return connection.execute(
        "SELECT id, source_task_id, target_task_id, type FROM task_relationships "
        "ORDER BY id"
    ).fetchall()


_EXPECTED_RELATIONSHIPS = [
    ("rel_1", "todo_child", "todo_blocker", "depends_on"),
    ("rel_2", "todo_root", "todo_blocker", "depends_on"),
]


# ---------------------------------------------------------------------------
# The harness itself has to be right, or nothing below means anything
# ---------------------------------------------------------------------------


def test_the_legacy_fixture_really_lacks_the_check_constraint(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "fixture-check.db")

    with sqlite3.connect(database_path) as connection:
        table_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
        ).fetchone()[0]
        assert "ck_todos_status_valid" not in table_sql
        # No constraint and no trigger yet: the database accepts anything.
        _insert_todo(connection, "todo_unguarded", "banana")
        connection.commit()
        assert connection.execute(
            "SELECT status FROM todos WHERE id = 'todo_unguarded'"
        ).fetchone() == ("banana",)
        # And the seeded rows survived the fixture's own rewrite.
        assert _relationship_rows(connection) == _EXPECTED_RELATIONSHIPS


# ---------------------------------------------------------------------------
# No data loss
# ---------------------------------------------------------------------------


def test_adoption_preserves_every_row_a_todos_rebuild_would_destroy(
    tmp_path: Path,
):
    database_path = _make_legacy_database(tmp_path, "no-data-loss.db")

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == (_HEAD_REVISION,)

        # ON DELETE CASCADE rows: the ones the aliased probe exists to protect.
        assert _relationship_rows(connection) == _EXPECTED_RELATIONSHIPS
        assert connection.execute(
            "SELECT id, todo_id FROM attachments ORDER BY id"
        ).fetchall() == [("att_1", "todo_root")]

        # ON DELETE SET NULL links, which a rebuild would have blanked.
        assert connection.execute(
            "SELECT parent_id FROM todos WHERE id = 'todo_child'"
        ).fetchone() == ("todo_root",)
        assert connection.execute(
            "SELECT project_todo_id FROM conversations WHERE id = 'conv_1'"
        ).fetchone() == ("todo_root",)

        assert connection.execute(
            "SELECT id FROM todos ORDER BY id"
        ).fetchall() == [("todo_blocker",), ("todo_child",), ("todo_root",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_a_pre_existing_invalid_status_is_normalized_not_dropped(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "normalized.db")
    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_weird", "archived")
        connection.commit()

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        # The row is kept; only the unrepresentable status is normalized.
        assert connection.execute(
            "SELECT status, completed_at FROM todos WHERE id = 'todo_weird'"
        ).fetchone() == ("pending", None)


# ---------------------------------------------------------------------------
# The gap is actually closed: enforcement, not just normalization
# ---------------------------------------------------------------------------


def test_an_adopted_database_rejects_an_invalid_status_on_insert(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "guarded-insert.db")

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        with pytest.raises(sqlite3.IntegrityError, match=_INVALID_STATUS_MESSAGE):
            _insert_todo(connection, "todo_invalid", "banana")
        connection.rollback()
        assert connection.execute(
            "SELECT COUNT(*) FROM todos WHERE id = 'todo_invalid'"
        ).fetchone() == (0,)


def test_an_adopted_database_rejects_an_invalid_status_on_update(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "guarded-update.db")

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        with pytest.raises(sqlite3.IntegrityError, match=_INVALID_STATUS_MESSAGE):
            connection.execute(
                "UPDATE todos SET status = 'banana' WHERE id = 'todo_root'"
            )
        connection.rollback()
        assert connection.execute(
            "SELECT status FROM todos WHERE id = 'todo_root'"
        ).fetchone() == ("pending",)


def test_an_adopted_database_still_accepts_every_canonical_status(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "canonical.db")

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        for status in ("pending", "in_progress", "completed", "cancelled"):
            _insert_todo(connection, f"todo_{status}", status)
            connection.execute(
                "UPDATE todos SET status = ? WHERE id = 'todo_root'", (status,)
            )
        connection.commit()
        assert connection.execute(
            "SELECT COUNT(*) FROM todos WHERE status IN "
            "('pending', 'in_progress', 'completed', 'cancelled')"
        ).fetchone() == (7,)


def test_the_residual_gap_is_the_constraint_object_not_the_guarantee(
    tmp_path: Path,
):
    """Documents exactly what an adopted database still does not have.

    The CHECK constraint itself stays absent -- adding it needs the rewrite
    this revision refuses to perform.  Enforcement is carried by the triggers
    instead, and that difference is deliberate.
    """
    database_path = _make_legacy_database(tmp_path, "residual-gap.db")

    _run_init_db(database_path)

    with sqlite3.connect(database_path) as connection:
        table_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
        ).fetchone()[0]
        assert "ck_todos_status_valid" not in table_sql

        triggers = {
            name
            for (name,) in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'trigger' AND tbl_name = 'todos'"
            )
        }
        assert {
            "ck_todos_status_valid_insert",
            "ck_todos_status_valid_update",
        } <= triggers


def test_a_fresh_database_gets_both_the_constraint_and_the_triggers(
    tmp_path: Path,
):
    """Enforcement must not depend on how old an installation is."""
    database_path = tmp_path / "fresh.db"
    _run_alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        table_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
        ).fetchone()[0]
        assert "ck_todos_status_valid" in table_sql
        triggers = {
            name
            for (name,) in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'trigger' AND tbl_name = 'todos'"
            )
        }
        assert {
            "ck_todos_status_valid_insert",
            "ck_todos_status_valid_update",
        } <= triggers

        with pytest.raises(sqlite3.IntegrityError):
            _insert_todo(connection, "todo_invalid", "banana")
        connection.rollback()


# ---------------------------------------------------------------------------
# Repeatability
# ---------------------------------------------------------------------------


def test_a_second_startup_changes_nothing(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "idempotent.db")

    _run_init_db(database_path)
    with sqlite3.connect(database_path) as connection:
        first = connection.execute(
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
        ).fetchall()

    _run_init_db(database_path)
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
        ).fetchall() == first
        assert _relationship_rows(connection) == _EXPECTED_RELATIONSHIPS


def test_downgrade_removes_the_triggers_without_touching_rows(tmp_path: Path):
    database_path = _make_legacy_database(tmp_path, "downgrade.db")
    _run_init_db(database_path)

    _run_alembic(database_path, "downgrade", _BELOW_TRIGGER_REVISION)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == (_BELOW_TRIGGER_REVISION,)
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' "
            "AND name LIKE 'ck_todos_status_valid%'"
        ).fetchone() == (0,)
        assert _relationship_rows(connection) == _EXPECTED_RELATIONSHIPS
        # With the triggers gone the guard is gone too -- which is the point:
        # nothing else in the schema was carrying it.
        _insert_todo(connection, "todo_after_downgrade", "banana")
        connection.commit()


def test_the_baseline_revision_is_still_reachable_by_downgrade(tmp_path: Path):
    """The new head must not strand the existing downgrade path."""
    database_path = tmp_path / "full-downgrade.db"
    _run_alembic(database_path, "upgrade", "head")
    with sqlite3.connect(database_path) as connection:
        _insert_todo(connection, "todo_kept", "pending")
        connection.commit()

    _run_alembic(database_path, "downgrade", _BASELINE_REVISION)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT id FROM todos"
        ).fetchall() == [("todo_kept",)]
