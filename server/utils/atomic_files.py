"""Crash-safe text writes with per-path process-local serialization."""

import os
import stat
import tempfile
import threading
from contextlib import ExitStack, contextmanager
from typing import Iterator


_locks_guard = threading.Lock()
_path_locks: dict[str, threading.RLock] = {}


def _lock_key(path: str) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


@contextmanager
def synchronized_path(path: str) -> Iterator[None]:
    """Serialize read-modify-write operations targeting the same file."""
    key = _lock_key(path)
    with _locks_guard:
        lock = _path_locks.setdefault(key, threading.RLock())
    with lock:
        yield


@contextmanager
def synchronized_paths(*paths: str) -> Iterator[None]:
    """Lock multiple paths in stable order to avoid cross-move deadlocks."""
    keys_and_paths = sorted({_lock_key(path): path for path in paths}.items())
    with ExitStack() as stack:
        for _key, path in keys_and_paths:
            stack.enter_context(synchronized_path(path))
        yield


def _sync_parent_directory(parent: str) -> None:
    if os.name == "nt":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        fd = os.open(parent, flags)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write_text(path: str, content: str) -> None:
    """Write UTF-8 text via same-directory temp file and atomic replace."""
    parent = os.path.dirname(path)
    os.makedirs(parent, exist_ok=True)

    existing_mode: int | None = None
    try:
        existing_mode = stat.S_IMODE(os.stat(path, follow_symlinks=False).st_mode)
    except FileNotFoundError:
        pass

    fd, temp_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(path)}.", suffix=".tmp", dir=parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as temp_file:
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        if existing_mode is not None:
            os.chmod(temp_path, existing_mode)
        os.replace(temp_path, path)
        _sync_parent_directory(parent)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


def atomic_write_lines(path: str, lines: list[str]) -> None:
    atomic_write_text(path, "".join(lines))
