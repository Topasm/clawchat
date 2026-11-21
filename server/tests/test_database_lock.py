"""One server per database file (ADR 021)."""

import errno
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from services import database_lock

SERVER_DIR = Path(__file__).resolve().parents[1]


def _url(path: Path) -> str:
    return f"sqlite+aiosqlite:///{path}"


def _claim(path: Path, *, owner: str = "desktop", port: int = 8000):
    return database_lock.acquire(
        _url(path), host="127.0.0.1", port=port, owner=owner, version="9.9.9"
    )


@pytest.fixture(autouse=True)
def _release_process_claim():
    yield
    database_lock.release()


def _hold_in_child(path: Path, *, owner: str = "service", port: int = 8123):
    """Start a separate process that holds the lock until its stdin closes."""
    script = textwrap.dedent(
        f"""
        import sys
        from services import database_lock
        held = database_lock.acquire(
            {_url(path)!r}, host="0.0.0.0", port={port}, owner={owner!r}, version="1.0.0"
        )
        print("held" if held else "unguarded", flush=True)
        sys.stdin.read()
        """
    )
    child = subprocess.Popen(
        [sys.executable, "-c", script],
        cwd=SERVER_DIR,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "PYTHONPATH": str(SERVER_DIR)},
    )
    assert child.stdout.readline().strip() == "held"
    return child


def _stop(child: subprocess.Popen) -> None:
    child.stdin.close()
    child.wait(timeout=10)


@pytest.mark.parametrize(
    "url",
    [
        "sqlite+aiosqlite:///:memory:",
        "sqlite+aiosqlite://",
        "sqlite:///file:shared?mode=memory&uri=true",
        "postgresql+asyncpg://user@localhost/clawchat",
        "not a url",
    ],
)
def test_only_a_sqlite_file_is_locked(url):
    assert database_lock.database_file(url) is None
    assert database_lock.acquire(url, host="h", port=1, owner="o", version="v") is None


def test_a_relative_database_resolves_against_the_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    assert database_lock.database_file("sqlite+aiosqlite:///./data/clawchat.db") == (
        tmp_path / "data" / "clawchat.db"
    )


def test_the_lock_and_owner_record_sit_beside_the_database(tmp_path):
    database = tmp_path / "server-data" / "data" / "clawchat.db"

    held = _claim(database, port=8000)

    assert held is not None
    assert database_lock.lock_path(database) == database.with_name("clawchat.db.lock")
    assert database_lock.lock_path(database).exists()
    owner = json.loads(database_lock.owner_path(database).read_text())
    assert owner["pid"] == os.getpid()
    assert owner["port"] == 8000
    assert owner["owner"] == "desktop"
    assert owner["version"] == "9.9.9"
    held.release()


def test_a_second_server_on_the_same_file_is_refused(tmp_path):
    database = tmp_path / "clawchat.db"
    holder = _hold_in_child(database, owner="service", port=8123)
    try:
        with pytest.raises(database_lock.DatabaseInUseError) as refused:
            _claim(database)
    finally:
        _stop(holder)

    message = str(refused.value)
    assert message.startswith(database_lock.IN_USE_MARKER)
    assert f"pid {holder.pid}" in message
    assert "port 8123" in message
    assert "started by the server-only service" in message
    assert refused.value.holder["owner"] == "service"


def test_a_different_database_is_not_affected(tmp_path):
    holder = _hold_in_child(tmp_path / "one.db")
    try:
        held = _claim(tmp_path / "two.db")
        assert held is not None
        held.release()
    finally:
        _stop(holder)


def test_the_lock_dies_with_its_process(tmp_path):
    database = tmp_path / "clawchat.db"
    holder = _hold_in_child(database)
    holder.kill()
    holder.wait(timeout=10)

    held = _claim(database)

    assert held is not None
    assert database_lock.read_owner(database)["pid"] == os.getpid()
    held.release()


def test_release_frees_the_file_and_clears_the_owner_record(tmp_path):
    database = tmp_path / "clawchat.db"
    first = _claim(database)
    first.release()
    first.release()

    assert not database_lock.owner_path(database).exists()
    second = _claim(database)
    assert second is not None
    second.release()


def test_release_keeps_an_owner_record_another_process_wrote(tmp_path):
    database = tmp_path / "clawchat.db"
    held = _claim(database)
    database_lock.owner_path(database).write_text(json.dumps({"pid": os.getpid() + 1}))

    held.release()

    assert database_lock.owner_path(database).exists()


def test_claim_is_idempotent_for_the_same_database(tmp_path):
    database = tmp_path / "clawchat.db"

    first = database_lock.claim(
        _url(database), host="0.0.0.0", port=8000, owner="service", version="1"
    )
    again = database_lock.claim(
        _url(database), host="127.0.0.1", port=9000, owner="standalone", version="2"
    )

    assert again is first
    assert database_lock.read_owner(database)["owner"] == "service"


def test_claim_moves_to_a_new_database(tmp_path):
    first = database_lock.claim(
        _url(tmp_path / "one.db"), host="h", port=1, owner="o", version="v"
    )
    second = database_lock.claim(
        _url(tmp_path / "two.db"), host="h", port=1, owner="o", version="v"
    )

    assert second is not first
    reclaimed = _claim(tmp_path / "one.db")
    assert reclaimed is not None
    reclaimed.release()


def test_a_filesystem_without_locks_runs_unguarded(tmp_path, monkeypatch, caplog):
    def no_locks(_handle):
        raise OSError(errno.ENOLCK, "No locks available")

    monkeypatch.setattr(database_lock, "_try_lock", no_locks)

    assert _claim(tmp_path / "clawchat.db") is None
    assert "running without the one-server-per-database guard" in caplog.text


def test_the_packaged_entry_exits_with_a_distinct_code_when_in_use(tmp_path):
    database = tmp_path / "clawchat.db"
    holder = _hold_in_child(database, owner="desktop", port=8000)
    script = textwrap.dedent(
        f"""
        from services import database_lock
        database_lock.claim_or_exit(
            {_url(database)!r}, host="127.0.0.1", port=8001, owner="service", version="1"
        )
        """
    )
    try:
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=SERVER_DIR,
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "PYTHONPATH": str(SERVER_DIR)},
        )
    finally:
        _stop(holder)

    assert result.returncode == database_lock.EXIT_DATABASE_IN_USE
    assert result.stderr.strip().startswith(database_lock.IN_USE_MARKER)
    assert "started by the desktop app" in result.stderr
