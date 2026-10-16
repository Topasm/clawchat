"""Per-connection SQLite settings and WAL-safe backups."""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from services import admin_service


def test_every_sqlite_connection_runs_in_wal_with_a_busy_timeout(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'settings.db'}")
    try:
        with engine.connect() as connection:
            def pragma(name: str):
                return connection.execute(text(f"PRAGMA {name}")).scalar_one()

            assert pragma("journal_mode") == "wal"
            assert pragma("synchronous") == 1  # NORMAL
            assert pragma("busy_timeout") == 5000
            assert pragma("temp_store") == 2  # MEMORY
            assert pragma("foreign_keys") == 1
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_backup_includes_commits_still_in_the_wal(tmp_path: Path, monkeypatch):
    database_path = tmp_path / "live.db"
    monkeypatch.setattr(
        admin_service.settings,
        "database_url",
        f"sqlite+aiosqlite:///{database_path}",
    )
    live = sqlite3.connect(database_path)
    try:
        live.execute("PRAGMA journal_mode=WAL")
        live.execute("PRAGMA wal_autocheckpoint=0")
        live.execute("CREATE TABLE notes (body TEXT)")
        live.execute("INSERT INTO notes VALUES ('kept')")
        live.commit()
        # The commit lives only in -wal while this connection stays open.
        assert Path(f"{database_path}-wal").stat().st_size > 0

        filename, size = await admin_service.backup_database()
    finally:
        live.close()

    backup_path = tmp_path / "backups" / filename
    assert size == backup_path.stat().st_size
    assert not Path(f"{backup_path}.partial").exists()
    with sqlite3.connect(backup_path) as copy:
        assert copy.execute("SELECT body FROM notes").fetchall() == [("kept",)]
        assert copy.execute("PRAGMA journal_mode").fetchone() == ("delete",)
