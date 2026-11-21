"""One server per database file.

Two servers on one SQLite file would both run migrations, both run the
scheduler and both hand the same work to the same machines. The desktop app,
the headless ``--server-only`` service and a server started by hand can all be
pointed at the same file, so the server itself takes an exclusive OS lock on
``<db>.lock`` before it touches the database, and refuses to start while
another process holds it. The OS drops the lock when the process dies, so a
crash never leaves it stale.

Who holds the lock is written to ``<db>.owner.json`` (pid, port, who started
it), so the desktop shell can connect to the running server instead of
starting a second one. That file is only meaningful while the lock is held;
``src-tauri/src/services/database_lock.rs`` reads the same pair. See ADR 021.
"""

from __future__ import annotations

import errno
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import IO

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

from utils.atomic_files import atomic_write_text

logger = logging.getLogger(__name__)

LOCK_SUFFIX = ".lock"
OWNER_SUFFIX = ".owner.json"

#: The desktop shell looks for this phrase in a failed start's output to tell
#: "someone else already serves this workspace" from a real startup failure.
IN_USE_MARKER = "ClawChat database in use"

#: EX_TEMPFAIL: the database may be free again later (the service retries).
EXIT_DATABASE_IN_USE = 75

_OWNER_LABELS = {
    "desktop": "the desktop app",
    "service": "the server-only service",
}


class DatabaseInUseError(RuntimeError):
    """Another live process holds the database's lock."""

    def __init__(self, database: Path, holder: dict | None):
        self.database = database
        self.holder = holder
        super().__init__(describe_conflict(database, holder))


@dataclass
class DatabaseLock:
    database: Path
    _handle: IO[bytes] = field(repr=False)

    def release(self) -> None:
        """Drop the lock and the owner record. Safe to call twice."""
        if self._handle.closed:
            return
        owner = owner_path(self.database)
        try:
            recorded = _read_json(owner)
            if recorded is not None and recorded.get("pid") == os.getpid():
                owner.unlink(missing_ok=True)
        except OSError:
            pass
        # Closing the descriptor releases flock and msvcrt locks alike.
        self._handle.close()


def database_file(database_url: str) -> Path | None:
    """The SQLite file a URL points at, or ``None`` for anything else."""
    try:
        url = make_url(database_url)
    except ArgumentError:
        return None
    if url.get_backend_name() != "sqlite":
        return None
    database = url.database or ""
    if database in ("", ":memory:") or database.startswith("file:"):
        return None
    if url.query.get("mode") == "memory":
        return None
    return Path(os.path.abspath(os.path.expanduser(database)))


def lock_path(database: Path) -> Path:
    return database.with_name(database.name + LOCK_SUFFIX)


def owner_path(database: Path) -> Path:
    return database.with_name(database.name + OWNER_SUFFIX)


def read_owner(database: Path) -> dict | None:
    """Who last claimed ``database``; only current while its lock is held."""
    try:
        return _read_json(owner_path(database))
    except OSError:
        return None


def describe_conflict(database: Path, holder: dict | None) -> str:
    who = "another server"
    if holder:
        details = []
        if holder.get("pid"):
            details.append(f"pid {holder['pid']}")
        if holder.get("port"):
            details.append(f"port {holder['port']}")
        label = _OWNER_LABELS.get(str(holder.get("owner", "")))
        if label:
            details.append(f"started by {label}")
        if details:
            who = f"another server ({', '.join(details)})"
    return (
        f"{IN_USE_MARKER}: {who} already serves {database}. "
        "Two servers must never share one database; stop that one first."
    )


def acquire(
    database_url: str,
    *,
    host: str,
    port: int,
    owner: str,
    version: str,
) -> DatabaseLock | None:
    """Claim the database for this process.

    Returns ``None`` when the URL is not a SQLite file, or when the filesystem
    cannot lock at all (some network mounts); the server then runs unguarded,
    as it did before this lock existed. Raises :class:`DatabaseInUseError`
    when another process holds it.
    """
    database = database_file(database_url)
    if database is None:
        return None
    database.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path(database), "a+b")  # noqa: SIM115 -- held for the process lifetime
    try:
        _try_lock(handle)
    except OSError as error:
        handle.close()
        if _lock_is_held(error):
            raise DatabaseInUseError(database, read_owner(database)) from None
        logger.warning(
            "Could not lock %s (%s); running without the one-server-per-database guard",
            lock_path(database),
            error,
        )
        return None

    record = {
        "pid": os.getpid(),
        "host": host,
        "port": port,
        "owner": owner,
        "version": version,
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    try:
        atomic_write_text(str(owner_path(database)), json.dumps(record, indent=2) + "\n")
    except OSError as error:
        # The lock alone still keeps a second server out; only the desktop
        # shell's "connect to it" shortcut needs this record.
        logger.warning("Could not record the database owner in %s: %s", owner_path(database), error)
    return DatabaseLock(database=database, _handle=handle)


_held: DatabaseLock | None = None


def claim(
    database_url: str,
    *,
    host: str,
    port: int,
    owner: str,
    version: str,
) -> DatabaseLock | None:
    """Claim the database for the rest of this process, once.

    The packaged entry point claims before uvicorn starts so a conflict exits
    cleanly; the app lifespan claims again for every other way of starting the
    server. The second call is a no-op for the same database.
    """
    global _held
    database = database_file(database_url)
    if _held is not None:
        if not _held._handle.closed and _held.database == database:
            return _held
        _held.release()
        _held = None
    _held = acquire(database_url, host=host, port=port, owner=owner, version=version)
    return _held


def release() -> None:
    global _held
    if _held is not None:
        _held.release()
        _held = None


def claim_or_exit(
    database_url: str,
    *,
    host: str,
    port: int,
    owner: str,
    version: str,
) -> DatabaseLock | None:
    """:func:`claim`, or print why not and exit with ``EXIT_DATABASE_IN_USE``."""
    try:
        return claim(database_url, host=host, port=port, owner=owner, version=version)
    except DatabaseInUseError as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(EXIT_DATABASE_IN_USE) from None


def _try_lock(handle: IO[bytes]) -> None:
    if os.name == "nt":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _lock_is_held(error: OSError) -> bool:
    if isinstance(error, BlockingIOError):
        return True
    held = {errno.EAGAIN, errno.EWOULDBLOCK, errno.EACCES}
    if os.name == "nt":
        held.add(getattr(errno, "EDEADLOCK", errno.EDEADLK))
    return error.errno in held


def _read_json(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None
