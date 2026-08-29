"""Guard the one invariant that lets Alembic own the schema alone.

``tests/conftest.py`` still builds its in-memory database with
``Base.metadata.create_all`` because migrating a throwaway database per test is
pure overhead. That is only safe while the ORM metadata and the Alembic head
describe the same schema. If they ever diverge -- a column added to a model
without a revision, or a revision that drifts from its model -- every test would
keep passing against a schema production never gets.

This module compares the two directly, so the drift fails CI instead.
"""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

_SERVER_ROOT = Path(__file__).resolve().parents[1]

_CREATE_ALL_SCRIPT = """
import asyncio
from database import Base, engine
from models import _register_all  # noqa: F401


async def main():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await engine.dispose()


asyncio.run(main())
"""


def _server_env(database_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": (
                f"sqlite+aiosqlite:///{database_path.resolve().as_posix()}"
            ),
            "JWT_SECRET": "schema-parity-test-secret",
            "UPLOAD_DIR": str(database_path.parent / "uploads"),
        }
    )
    return env


def _run(database_path: Path, *arguments: str, script: str | None = None) -> None:
    command = (
        [sys.executable, "-c", script]
        if script is not None
        else [sys.executable, "-m", "alembic", *arguments]
    )
    result = subprocess.run(
        command,
        cwd=_SERVER_ROOT,
        env=_server_env(database_path),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"{' '.join(command[1:])} failed\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
        # Only the migrated database carries the bookkeeping table.
        if row[0] != "alembic_version"
    }


def _columns(connection: sqlite3.Connection, table: str) -> set[tuple]:
    return {
        (row[1], row[2].upper(), bool(row[3]), row[4], bool(row[5]))
        for row in connection.execute(f"PRAGMA table_info('{table}')")
    }


def _indexes(connection: sqlite3.Connection, table: str) -> dict[str, tuple]:
    indexes: dict[str, tuple] = {}
    for row in connection.execute(f"PRAGMA index_list('{table}')"):
        name = row[1]
        if name.startswith("sqlite_autoindex"):
            continue
        columns = tuple(
            entry[2] for entry in connection.execute(f"PRAGMA index_info('{name}')")
        )
        indexes[name] = (bool(row[2]), columns)
    return indexes


@pytest.fixture(scope="module")
def schema_pair(tmp_path_factory) -> tuple[Path, Path]:
    directory = tmp_path_factory.mktemp("schema-parity")
    migrated = directory / "alembic-head.db"
    declared = directory / "create-all.db"
    _run(migrated, "upgrade", "head")
    _run(declared, script=_CREATE_ALL_SCRIPT)
    return migrated, declared


def test_alembic_head_and_orm_metadata_declare_the_same_tables(schema_pair):
    migrated, declared = schema_pair
    with sqlite3.connect(migrated) as head, sqlite3.connect(declared) as orm:
        assert _tables(head) == _tables(orm)


def test_alembic_head_and_orm_metadata_declare_the_same_columns(schema_pair):
    migrated, declared = schema_pair
    differences: dict[str, dict[str, list]] = {}
    with sqlite3.connect(migrated) as head, sqlite3.connect(declared) as orm:
        for table in sorted(_tables(head) & _tables(orm)):
            head_columns = _columns(head, table)
            orm_columns = _columns(orm, table)
            if head_columns != orm_columns:
                differences[table] = {
                    "only_after_upgrade": sorted(head_columns - orm_columns),
                    "only_in_create_all": sorted(orm_columns - head_columns),
                }
    assert not differences, differences


def test_alembic_head_and_orm_metadata_declare_the_same_indexes(schema_pair):
    migrated, declared = schema_pair
    differences: dict[str, dict[str, dict]] = {}
    with sqlite3.connect(migrated) as head, sqlite3.connect(declared) as orm:
        for table in sorted(_tables(head) & _tables(orm)):
            head_indexes = _indexes(head, table)
            orm_indexes = _indexes(orm, table)
            if head_indexes != orm_indexes:
                differences[table] = {
                    "after_upgrade": head_indexes,
                    "create_all": orm_indexes,
                }
    assert not differences, differences


def test_alembic_autogenerate_finds_no_pending_schema_change(tmp_path: Path):
    """``alembic check`` catches drift the table dumps above cannot see.

    Constraints, server defaults and type changes are compared here through the
    same ``include_object`` rules ``migrations/env.py`` configures, so the two
    checks together cover the whole schema.
    """
    database_path = tmp_path / "autogenerate-check.db"
    _run(database_path, "upgrade", "head")
    _run(database_path, "check")
