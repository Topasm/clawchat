"""Cached vault index — maintains an in-memory project-folder map with document
summaries and staleness tracking.

The indexer scans the Obsidian vault for project folders (identified by a
configurable TODO file, default ``TODO.md``) and caches metadata such as
folder paths, document summaries, and modification times.  The inbox pipeline
and planning service use this index for fast lookups instead of hitting the
filesystem on every request.
"""

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from config import settings
from services.obsidian_context_service import (
    list_project_folders,
    read_project_context,
)

logger = logging.getLogger(__name__)

# Default staleness threshold in seconds (5 minutes).
_DEFAULT_STALE_SECONDS = 300


@dataclass
class ProjectEntry:
    """Cached metadata for a single project folder."""
    folder: str          # vault-relative path
    name: str            # human-readable folder name
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
    scan_duration_ms: float = 0.0
    vault_path: str = ""
    is_available: bool = False
    cli_available: bool = False
    companion_online: bool = False
    error: str | None = None


# Module-level singleton
_index = VaultIndex()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_index() -> VaultIndex:
    """Return the current vault index (may be stale)."""
    return _index


def get_project_entry(folder: str) -> ProjectEntry | None:
    """Return cached metadata for a specific project folder."""
    return _index.projects.get(folder)


def get_project_names() -> list[str]:
    """Return a sorted list of known project folder names."""
    return sorted(e.name for e in _index.projects.values())


def is_stale(max_age_seconds: int | None = None) -> bool:
    """Return True if the index needs refreshing."""
    if not _index.last_full_scan:
        return True
    threshold = max_age_seconds or (settings.obsidian_scan_interval_minutes * 60)
    return (time.time() - _index.last_full_scan) > threshold


def refresh_index() -> VaultIndex:
    """Re-scan the vault and rebuild the in-memory index.

    This is a synchronous operation because vault scanning is filesystem I/O
    that runs quickly for typical vault sizes (< 1000 folders).
    """
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
        folders = list_project_folders(vault_path, cli_command)
    except Exception as exc:
        logger.exception("Failed to list project folders during index refresh")
        _index.error = str(exc)
        _index.is_available = False
        return _index

    projects: dict[str, ProjectEntry] = {}

    for folder_info in folders:
        folder_rel = folder_info["folder"]
        folder_name = folder_info["name"]

        entry = ProjectEntry(
            folder=folder_rel,
            name=folder_name,
            scanned_at=time.time(),
        )

        # Read TODO.md and compute hash + preview
        try:
            ctx = read_project_context(vault_path, folder_rel, cli_command)
            todo_md = ctx.get("todo_md", "")
            if todo_md:
                entry.todo_md_hash = hashlib.md5(todo_md.encode()).hexdigest()
                entry.todo_md_preview = todo_md[:200].strip()

            # Document summaries
            related = ctx.get("related_docs", [])
            entry.doc_summaries = [
                {"name": doc["name"], "summary": doc["content"][:200].strip()}
                for doc in related
            ]

            # Find most recent mtime
            abs_folder = os.path.join(vault_path, folder_rel)
            if os.path.isdir(abs_folder):
                try:
                    mtimes = []
                    with os.scandir(abs_folder) as entries:
                        for e in entries:
                            if e.is_file() and e.name.endswith(".md"):
                                try:
                                    mtimes.append(e.stat().st_mtime)
                                except OSError:
                                    pass
                    if mtimes:
                        entry.last_modified = max(mtimes)
                except OSError:
                    pass

        except Exception:
            logger.warning("Failed to read context for project %s", folder_rel, exc_info=True)

        projects[folder_rel] = entry

    elapsed_ms = (time.monotonic() - start) * 1000

    # Check CLI availability
    cli_ok = False
    if cli_command:
        import subprocess
        try:
            proc = subprocess.run(
                [cli_command, "version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            cli_ok = proc.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            cli_ok = False

    # Check companion node
    companion_online = _check_companion_online(vault_path, cli_command) if settings.obsidian_companion_node_required else True

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


def get_health_summary() -> dict:
    """Return a health summary dict suitable for API responses."""
    from services.obsidian_cli_service import (
        get_cli_error_log,
        get_dead_letter_status,
        get_last_successful_cli_at,
        get_queue_status,
    )
    from services.vault_watcher_service import is_scan_stuck

    idx = _index

    # Queue age
    queue = get_queue_status()
    queue_age = queue.get("oldest_age_seconds")

    # Dead letter count
    dead_letter = get_dead_letter_status()

    # Last CLI error
    error_log = get_cli_error_log()
    last_cli_error = error_log[0] if error_log else None

    return {
        "vault_available": idx.is_available,
        "vault_path": idx.vault_path,
        "cli_available": idx.cli_available,
        "companion_online": idx.companion_online,
        "sync_mode": settings.obsidian_sync_mode,
        "project_count": len(idx.projects),
        "last_scan": idx.last_full_scan or None,
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


def ensure_fresh(max_age_seconds: int | None = None) -> VaultIndex:
    """Refresh the index if it is stale, then return it."""
    if is_stale(max_age_seconds):
        return refresh_index()
    return _index


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_companion_online(vault_path: str, cli_command: str) -> bool:
    """Heuristic check for whether the companion node is online.

    - In ``livesync`` mode: checks if the LiveSync plugin is configured
      (``data.json`` exists in the plugin directory) as a proxy for CouchDB
      connectivity.
    - In ``filesystem`` mode: checks if ``.obsidian/workspace.json`` was
      modified recently (within 10 minutes), suggesting an active Obsidian
      instance.
    """
    if not cli_command:
        return False

    obsidian_dir = os.path.join(vault_path, ".obsidian")
    if not os.path.isdir(obsidian_dir):
        return False

    # LiveSync mode: check for LiveSync plugin configuration
    if settings.obsidian_sync_mode == "livesync":
        livesync_data = os.path.join(
            obsidian_dir, "plugins", "obsidian-livesync", "data.json"
        )
        if os.path.isfile(livesync_data):
            try:
                mtime = os.path.getmtime(livesync_data)
                age = time.time() - mtime
                # LiveSync config exists and was touched in last hour
                return age < 3600
            except OSError:
                pass
        return False

    # Filesystem mode: check workspace.json recency
    try:
        workspace_file = os.path.join(obsidian_dir, "workspace.json")
        if os.path.isfile(workspace_file):
            mtime = os.path.getmtime(workspace_file)
            age = time.time() - mtime
            return age < 600  # 10 minutes
    except OSError:
        pass

    return False
