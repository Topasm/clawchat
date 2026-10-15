"""Cached vault index — maintains an in-memory project-folder map with document
summaries and staleness tracking.

The indexer scans the Obsidian vault for project folders (folders holding a
``TODO.md``, plus every folder under the configured project root) and caches
metadata such as
folder paths, document summaries, and modification times.  The inbox pipeline
and planning service use this index for fast lookups instead of hitting the
filesystem on every request.
"""

import hashlib
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from config import settings
from services.vault import obsidian_status
from services.vault.obsidian_context_service import (
    TODO_FILENAME,
    is_project_root_child,
    list_project_folders,
    read_project_context,
)
from utils.vault_paths import (
    VaultPathError,
    normalize_vault_relative_path,
    resolve_vault_path,
)

logger = logging.getLogger(__name__)


@dataclass
class ProjectEntry:
    """Cached metadata for a single project folder."""
    folder: str          # vault-relative path
    name: str            # human-readable folder name
    has_todo: bool = True  # False for a project-root folder awaiting its TODO.md
    todo_md_hash: str = ""
    todo_md_preview: str = ""  # first 200 chars
    doc_summaries: list[dict[str, str]] = field(default_factory=list)
    last_modified: float = 0.0  # mtime of most recently changed file
    scanned_at: float = 0.0


@dataclass
class VaultIndex:
    """Complete vault index state."""
    projects: dict[str, ProjectEntry] = field(default_factory=dict)  # keyed by folder path
    last_full_scan: float = 0.0
    last_incremental_scan: float = 0.0
    scan_duration_ms: float = 0.0
    vault_path: str = ""
    is_available: bool = False
    cli_available: bool = False
    companion_online: bool = False
    error: str | None = None


# Module-level singleton
_index = VaultIndex()
_index_lock = threading.RLock()
_scanning = False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def is_stale(max_age_seconds: int | None = None) -> bool:
    """Return True if the index needs refreshing."""
    if not _index.last_full_scan:
        return True
    threshold = max_age_seconds or (settings.obsidian_scan_interval_minutes * 60)
    return (time.time() - _index.last_full_scan) > threshold


def index_state() -> str:
    """Where the index is: ``disabled``, ``pending``, ``scanning``, ``ready``
    or ``error``."""
    if _scanning:
        return "scanning"
    if not settings.obsidian_vault_path:
        return "disabled"
    if _index.error:
        return "error"
    if _index.last_full_scan:
        return "ready"
    return "pending"


def refresh_index() -> VaultIndex:
    """Re-scan the vault and rebuild the in-memory index.

    Blocking filesystem and CLI I/O: a large vault behind the CLI takes tens
    of seconds, so callers on the event loop run it in a worker thread, and
    startup runs it in the background (see ``services.lifecycle``).
    """
    global _scanning
    with _index_lock:
        _scanning = True
        try:
            return _refresh_index_locked()
        finally:
            _scanning = False


def _refresh_index_locked() -> VaultIndex:
    global _index

    vault_path = settings.obsidian_vault_path
    cli_command = settings.obsidian_cli_command

    if not vault_path or not os.path.isdir(vault_path):
        _index = VaultIndex(
            vault_path=vault_path,
            is_available=False,
            error="Vault path not configured or does not exist",
        )
        return _index

    start = time.monotonic()

    try:
        folders = list_project_folders(
            vault_path, cli_command, settings.obsidian_project_root
        )
    except Exception as exc:
        logger.exception("Failed to list project folders during index refresh")
        _index.error = str(exc)
        _index.is_available = False
        return _index

    projects: dict[str, ProjectEntry] = {}

    for folder_info in folders:
        folder_rel = folder_info["folder"]
        try:
            projects[folder_rel] = _build_project_entry(
                vault_path,
                folder_rel,
                folder_info["name"],
                cli_command,
                has_todo=folder_info.get("has_todo", True),
            )
        except Exception:
            logger.warning(
                "Failed to read context for project %s", folder_rel, exc_info=True
            )

    elapsed_ms = (time.monotonic() - start) * 1000

    # A full refresh re-probes, so a reindex picks up a CLI fixed meanwhile.
    cli_ok = obsidian_status.probe_cli(force=True)
    companion_online = obsidian_status.check_companion_online(vault_path)

    _index = VaultIndex(
        projects=projects,
        last_full_scan=time.time(),
        scan_duration_ms=round(elapsed_ms, 1),
        vault_path=vault_path,
        is_available=True,
        cli_available=cli_ok,
        companion_online=companion_online,
        error=None,
    )

    logger.info(
        "Vault index refreshed: %d projects in %.0fms (CLI=%s, companion=%s)",
        len(projects),
        elapsed_ms,
        cli_ok,
        companion_online,
    )

    return _index


def refresh_changed_paths(changed_paths: set[str] | list[str]) -> VaultIndex:
    """Refresh only projects affected by filesystem watcher paths."""
    with _index_lock:
        return _refresh_changed_paths_locked(changed_paths)


def _refresh_changed_paths_locked(
    changed_paths: set[str] | list[str],
) -> VaultIndex:
    global _index

    vault_path = settings.obsidian_vault_path
    if (
        not vault_path
        or not os.path.isdir(vault_path)
        or not _index.is_available
        or Path(_index.vault_path).resolve(strict=False)
        != Path(vault_path).resolve(strict=False)
    ):
        return refresh_index()

    affected_folders: set[str] = set()
    projects = dict(_index.projects)
    known_folders = sorted(projects, key=len, reverse=True)
    todo_filename = settings.obsidian_project_todo_filename
    project_root = settings.obsidian_project_root

    for changed_path in changed_paths:
        absolute = (
            changed_path
            if os.path.isabs(changed_path)
            else os.path.join(vault_path, changed_path)
        )
        relative = os.path.relpath(absolute, vault_path)
        try:
            relative = normalize_vault_relative_path(relative)
            resolve_vault_path(vault_path, relative)
        except VaultPathError:
            continue
        if any(part.startswith(".") for part in Path(relative).parts):
            continue

        matched = next(
            (
                folder
                for folder in known_folders
                if relative == folder or relative.startswith(f"{folder}/")
            ),
            None,
        )
        if matched:
            affected_folders.add(matched)
        elif os.path.basename(relative) == todo_filename:
            folder = os.path.dirname(relative).replace(os.sep, "/")
            if folder:
                affected_folders.add(folder)
        elif is_project_root_child(relative, project_root):
            affected_folders.add(relative)
        elif is_project_root_child(os.path.dirname(relative), project_root):
            affected_folders.add(os.path.dirname(relative))
        elif os.path.isdir(absolute):
            try:
                candidate = resolve_vault_path(
                    vault_path, f"{relative}/{todo_filename}"
                )
            except VaultPathError:
                continue
            if os.path.isfile(candidate):
                affected_folders.add(relative)

    for folder in affected_folders:
        try:
            todo_path = resolve_vault_path(vault_path, f"{folder}/{todo_filename}")
        except VaultPathError:
            projects.pop(folder, None)
            continue
        has_todo = os.path.isfile(todo_path)
        # A folder under the project root stays a project until it is removed.
        in_root = is_project_root_child(folder, project_root) and os.path.isdir(
            os.path.dirname(todo_path)
        )
        if not has_todo and not in_root:
            projects.pop(folder, None)
            continue
        try:
            projects[folder] = _build_project_entry(
                vault_path,
                folder,
                Path(folder).name,
                settings.obsidian_cli_command,
                has_todo=has_todo,
            )
        except Exception:
            logger.warning(
                "Failed to refresh changed project %s", folder, exc_info=True
            )

    _index.projects = projects
    _index.last_incremental_scan = time.time()
    return _index


def get_health_summary() -> dict:
    """Return a health summary dict suitable for API responses."""
    from services.vault.obsidian_cli_service import (
        get_cli_error_log,
        get_dead_letter_status,
        get_last_successful_cli_at,
        get_queue_status,
    )
    from services.vault.vault_watcher_service import is_scan_stuck

    # Populate the index on first health check, but never wait behind a scan
    # already running (startup's): report it as ``index_state: scanning``.
    idx = ensure_fresh(wait=False)
    availability = obsidian_status.get_availability()

    # Queue age
    queue = get_queue_status()
    queue_age = queue.get("oldest_age_seconds")

    # Dead letter count
    dead_letter = get_dead_letter_status()

    # Last CLI error
    error_log = get_cli_error_log()
    last_cli_error = error_log[0] if error_log else None

    return {
        # Availability comes from the same place as /api/obsidian/status.
        "vault_available": availability.vault_available,
        "vault_path": availability.vault_path,
        "cli_available": availability.cli_available,
        "companion_online": availability.companion_online,
        "mode": availability.mode,
        "project_root": availability.project_root,
        "index_state": availability.index_state,
        "sync_mode": settings.obsidian_sync_mode,
        "project_count": len(idx.projects),
        "last_scan": idx.last_full_scan or None,
        "last_incremental_scan": idx.last_incremental_scan or None,
        "scan_duration_ms": idx.scan_duration_ms,
        "is_stale": is_stale(),
        "error": idx.error,
        # Enriched fields
        "queue_pending": queue["pending"],
        "queue_age_seconds": queue_age,
        "dead_letter_count": dead_letter["count"],
        "last_cli_error": last_cli_error,
        "last_successful_cli_at": get_last_successful_cli_at() or None,
        "scan_stuck": is_scan_stuck(),
    }


def ensure_fresh(
    max_age_seconds: int | None = None, *, wait: bool = True
) -> VaultIndex:
    """Refresh the index if it is stale, then return it.

    With ``wait=False`` a scan already running elsewhere is not waited for;
    the current (possibly empty) index is returned instead.
    """
    if not is_stale(max_age_seconds):
        return _index
    if not _index_lock.acquire(blocking=wait):
        return _index
    try:
        # A scan that held the lock meanwhile may have refreshed it already.
        if not is_stale(max_age_seconds):
            return _index
        return refresh_index()
    finally:
        _index_lock.release()


class ProjectTodoError(ValueError):
    """Why a ``TODO.md`` could not be created; ``reason`` is a stable code."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


def create_project_todo(folder: str) -> ProjectEntry:
    """Create a starter ``TODO.md`` in a project-root folder that has none.

    Only folders directly under the project root qualify: those are the ones
    listed as projects before they have a ``TODO.md``. An existing file is
    never overwritten.
    """
    vault_path = settings.obsidian_vault_path
    if not vault_path or not os.path.isdir(vault_path):
        raise ProjectTodoError("vault_unavailable", "Obsidian vault is not available")
    if not is_project_root_child(folder, settings.obsidian_project_root):
        raise ProjectTodoError(
            "not_in_project_root", "Folder is not directly under the project root"
        )
    try:
        folder = normalize_vault_relative_path(folder)
        abs_folder = resolve_vault_path(vault_path, folder)
        todo_path = resolve_vault_path(vault_path, f"{folder}/{TODO_FILENAME}")
    except VaultPathError as exc:
        raise ProjectTodoError("invalid_folder", str(exc)) from exc
    if not os.path.isdir(abs_folder):
        raise ProjectTodoError("folder_missing", "Project folder does not exist")

    name = Path(folder).name
    try:
        # "x" refuses to replace a TODO.md that appeared in the meantime.
        with open(todo_path, "x", encoding="utf-8", newline="") as handle:
            handle.write(f"# {name}\n\n")
    except FileExistsError as exc:
        raise ProjectTodoError("todo_exists", f"{TODO_FILENAME} already exists") from exc

    index = refresh_changed_paths({todo_path})
    entry = index.projects.get(folder)
    if entry is None:
        entry = _build_project_entry(
            vault_path, folder, name, settings.obsidian_cli_command
        )
    return entry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_project_entry(
    vault_path: str,
    folder_rel: str,
    folder_name: str,
    cli_command: str,
    *,
    has_todo: bool = True,
) -> ProjectEntry:
    entry = ProjectEntry(
        folder=folder_rel,
        name=folder_name,
        has_todo=has_todo,
        scanned_at=time.time(),
    )
    ctx = read_project_context(vault_path, folder_rel, cli_command)
    todo_md = ctx.get("todo_md", "")
    if todo_md:
        entry.todo_md_hash = hashlib.md5(todo_md.encode()).hexdigest()
        entry.todo_md_preview = todo_md[:200].strip()

    related = ctx.get("related_docs", [])
    entry.doc_summaries = [
        {"name": doc["name"], "summary": doc["content"][:200].strip()}
        for doc in related
    ]

    abs_folder = resolve_vault_path(vault_path, folder_rel, must_exist=True)
    mtimes = []
    with os.scandir(abs_folder) as entries:
        for entry_on_disk in entries:
            if (
                entry_on_disk.is_file(follow_symlinks=False)
                and entry_on_disk.name.endswith(".md")
            ):
                try:
                    mtimes.append(entry_on_disk.stat(follow_symlinks=False).st_mtime)
                except OSError:
                    pass
    if mtimes:
        entry.last_modified = max(mtimes)
    return entry
