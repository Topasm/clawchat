"""Read-only service for gathering project context from an Obsidian vault.

This service scans vault folders for TODO.md files and reads related markdown
documents to provide project context to the AI.  It never writes to the vault;
writing is handled by ``obsidian_export_service.py``.
"""

import logging
import os
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Folders excluded from project scanning.
_EXCLUDED_NAMES: set[str] = {
    ".obsidian",
    "templates",
    "Templates",
    "Daily",
    "Journal",
    "Dailies",
}

_MAX_DOC_BYTES = 4096
_MAX_RELATED_DOCS = 3


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_project_folders(
    vault_path: str,
    cli_command: str = "",
) -> list[dict[str, str]]:
    """Return folders that contain a ``TODO.md`` file.

    Each entry is ``{"folder": <relative_path>, "name": <folder_name>}``.
    If *cli_command* is set, the CLI is tried first; on failure we fall back
    to the filesystem.
    """
    if cli_command:
        result = _list_via_cli(vault_path, cli_command)
        if result is not None:
            return result
        logger.debug("CLI listing failed or returned nothing; falling back to filesystem")

    return _list_via_filesystem(vault_path)


def read_project_context(
    vault_path: str,
    folder: str,
    cli_command: str = "",
) -> dict:
    """Read ``TODO.md`` and up to 3 recent ``.md`` files from *folder*.

    Returns::

        {
            "todo_md": "<contents of TODO.md>",
            "related_docs": [
                {"name": "filename.md", "content": "<first 4 KB>"},
                ...
            ],
        }
    """
    abs_folder = os.path.join(vault_path, folder)

    if not os.path.isdir(abs_folder):
        logger.warning("Project folder does not exist: %s", abs_folder)
        return {"todo_md": "", "related_docs": []}

    # Read TODO.md --------------------------------------------------------
    todo_path = os.path.join(abs_folder, "TODO.md")
    todo_md = _read_file_capped(todo_path)

    # Gather related .md files -------------------------------------------
    md_files: list[tuple[str, float]] = []

    if cli_command:
        cli_files = _list_files_via_cli(vault_path, folder, cli_command)
        if cli_files is not None:
            for name in cli_files:
                if name == "TODO.md":
                    continue
                full = os.path.join(abs_folder, name)
                if os.path.isfile(full):
                    md_files.append((name, os.path.getmtime(full)))

    # Fall back to filesystem if CLI produced nothing.
    if not md_files:
        md_files = _related_md_files_fs(abs_folder)

    # Sort by mtime descending, take top N.
    md_files.sort(key=lambda t: t[1], reverse=True)
    top_files = md_files[:_MAX_RELATED_DOCS]

    related_docs: list[dict[str, str]] = []
    for name, _mtime in top_files:
        content = _read_file_capped(os.path.join(abs_folder, name))
        if content:
            related_docs.append({"name": name, "content": content})

    return {"todo_md": todo_md, "related_docs": related_docs}


def resolve_project_folder(
    vault_path: str,
    project_name: str,
    cli_command: str = "",
) -> str | None:
    """Find the best-matching project folder for *project_name*.

    Matching strategy (case-insensitive):
    1. Exact folder-name match.
    2. Prefix match (folder name starts with query).
    3. Substring match (query appears anywhere in folder name).

    Returns the relative folder path, or ``None`` if no match is found.
    """
    folders = list_project_folders(vault_path, cli_command)
    if not folders:
        return None

    query = project_name.lower()

    # Pass 1: exact match
    for entry in folders:
        if entry["name"].lower() == query:
            return entry["folder"]

    # Pass 2: prefix match
    for entry in folders:
        if entry["name"].lower().startswith(query):
            return entry["folder"]

    # Pass 3: substring match
    for entry in folders:
        if query in entry["name"].lower():
            return entry["folder"]

    return None


# ---------------------------------------------------------------------------
# CLI helpers
# ---------------------------------------------------------------------------


def _list_via_cli(vault_path: str, cli_command: str) -> list[dict[str, str]] | None:
    """Use the configured CLI to list files, then filter for TODO.md entries."""
    try:
        proc = subprocess.run(
            [cli_command, "files", f"folder={vault_path}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode != 0:
            logger.debug("CLI list exited with %d: %s", proc.returncode, proc.stderr.strip())
            return None

        lines = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
        if not lines:
            return None

        results: list[dict[str, str]] = []
        seen: set[str] = set()
        for line in lines:
            # Expect relative paths like "ProjectA/TODO.md"
            path = Path(line)
            if path.name != "TODO.md":
                continue
            folder_rel = str(path.parent)
            if folder_rel == "." or folder_rel in seen:
                continue
            if _is_excluded(path.parent.parts):
                continue
            seen.add(folder_rel)
            results.append({"folder": folder_rel, "name": path.parent.name})

        return results if results else None
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.debug("CLI listing failed: %s", exc)
        return None


def _list_files_via_cli(
    vault_path: str,
    folder: str,
    cli_command: str,
) -> list[str] | None:
    """List ``.md`` files inside a specific folder via CLI."""
    try:
        target = os.path.join(vault_path, folder)
        proc = subprocess.run(
            [cli_command, "files", f"folder={target}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode != 0:
            return None

        names: list[str] = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if line and line.endswith(".md"):
                # CLI may return relative-to-target or absolute paths.
                name = Path(line).name
                if not name.startswith("."):
                    names.append(name)
        return names if names else None
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.debug("CLI file listing failed for %s: %s", folder, exc)
        return None


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------


def _list_via_filesystem(vault_path: str) -> list[dict[str, str]]:
    """Walk the vault at depth 1 and return folders containing TODO.md."""
    results: list[dict[str, str]] = []

    if not os.path.isdir(vault_path):
        logger.warning("Vault path does not exist: %s", vault_path)
        return results

    try:
        entries = os.scandir(vault_path)
    except OSError:
        logger.exception("Failed to scan vault path: %s", vault_path)
        return results

    with entries:
        for entry in entries:
            if not entry.is_dir(follow_symlinks=False):
                continue
            if _is_excluded_name(entry.name):
                continue
            todo_file = os.path.join(entry.path, "TODO.md")
            if os.path.isfile(todo_file):
                results.append({"folder": entry.name, "name": entry.name})

    results.sort(key=lambda d: d["name"].lower())
    return results


def _related_md_files_fs(abs_folder: str) -> list[tuple[str, float]]:
    """Return ``(filename, mtime)`` for ``.md`` files in *abs_folder*.

    Only scans depth-0 (direct children); hidden files and ``TODO.md`` are
    excluded.
    """
    md_files: list[tuple[str, float]] = []
    try:
        with os.scandir(abs_folder) as entries:
            for entry in entries:
                if not entry.is_file(follow_symlinks=False):
                    continue
                if entry.name.startswith("."):
                    continue
                if entry.name == "TODO.md":
                    continue
                if not entry.name.endswith(".md"):
                    continue
                try:
                    mtime = entry.stat().st_mtime
                except OSError:
                    continue
                md_files.append((entry.name, mtime))
    except OSError:
        logger.exception("Failed to scan folder: %s", abs_folder)
    return md_files


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _is_excluded_name(name: str) -> bool:
    """Return True if *name* should be excluded from scanning."""
    if name.startswith("."):
        return True
    return name in _EXCLUDED_NAMES


def _is_excluded(parts: tuple[str, ...]) -> bool:
    """Return True if any component in *parts* is excluded."""
    return any(_is_excluded_name(p) for p in parts)


def _read_file_capped(path: str) -> str:
    """Read up to ``_MAX_DOC_BYTES`` bytes from *path* and return as string."""
    if not os.path.isfile(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(_MAX_DOC_BYTES)
    except OSError:
        logger.debug("Could not read file: %s", path)
        return ""
