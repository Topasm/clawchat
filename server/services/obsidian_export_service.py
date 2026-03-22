"""One-way export of ClawChat todos to Obsidian vault markdown files.

Uses the Obsidian CLI service for new file creation and document moves
(to preserve internal links), falling back to direct filesystem writes
for line-level upserts within managed ``## ClawChat`` sections.
"""

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from config import settings
from models.todo import Todo
from utils import deserialize_tags

logger = logging.getLogger(__name__)

# HTML comment marker used to identify exported lines in markdown files.
# Invisible in Obsidian preview mode.
_MARKER_RE = re.compile(r"<!--\s*claw:(\S+)\s*-->")

_SECTION_HEADER = "## ClawChat"


@dataclass
class ExportResult:
    exported: int = 0
    removed: int = 0
    errors: int = 0
    file_count: int = 0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def export_todo(vault_path: str, todo: Todo, project_name: str | None = None) -> None:
    """Export a single todo to the Obsidian vault (create or update).

    For new files that don't yet exist, tries CLI creation first (so the
    document is tracked by Obsidian metadata).  Line-level upserts within
    existing files use direct filesystem writes.
    """
    try:
        _remove_all_markers(vault_path, todo.id)
        abs_path = _get_file_path(vault_path, project_name, source_id=todo.source_id)
        line = _todo_to_md_line(todo)

        # If the target file doesn't exist, try CLI creation first.
        if not os.path.isfile(abs_path):
            _create_file_via_cli_or_fs(vault_path, abs_path)

        _upsert_line(abs_path, todo.id, line)
    except Exception:
        logger.exception("Failed to export todo %s to vault", todo.id)


def remove_todo_from_vault(vault_path: str, todo_id: str) -> None:
    """Remove a todo line from all markdown files in the vault."""
    try:
        for dirpath, _dirs, filenames in os.walk(vault_path):
            for fname in filenames:
                if not fname.endswith(".md"):
                    continue
                abs_path = os.path.join(dirpath, fname)
                if _remove_line(abs_path, todo_id):
                    return
    except Exception:
        logger.exception("Failed to remove todo %s from vault", todo_id)


def export_all_todos(vault_path: str, todos: list[Todo]) -> ExportResult:
    """Full export of all todos to the vault.

    Groups todos by project (parent title) and writes each group to its own
    file.  Existing ``<!-- claw:... -->`` lines are replaced; new ones are
    appended under a ``## ClawChat`` section header.
    """
    result = ExportResult()

    # Build a parent-id → title lookup.
    parent_titles: dict[str, str] = {}
    for t in todos:
        if t.parent_id is None:
            parent_titles[t.id] = t.title

    # Group todos by resolved file path (source_id first, then parent title,
    # then inbox).
    grouped: dict[str, list[Todo]] = {}
    for t in todos:
        if t.source_id:
            project = None
        else:
            project = parent_titles.get(t.parent_id) if t.parent_id else None  # type: ignore[arg-type]
        abs_path = _get_file_path(vault_path, project, source_id=t.source_id)
        grouped.setdefault(abs_path, []).append(t)

    # Remove existing markers for every todo before writing to prevent
    # duplicates when todos move between folders.
    for group in grouped.values():
        for t in group:
            _remove_all_markers(vault_path, t.id)

    files_written: set[str] = set()
    for abs_path, group in grouped.items():
        try:
            _export_group(abs_path, group)
            files_written.add(abs_path)
            result.exported += len(group)
        except Exception:
            logger.exception("Failed to export group to %s", abs_path)
            result.errors += len(group)

    result.file_count = len(files_written)
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sanitize_name(name: str) -> str:
    """Sanitize a string for use as a directory/file name."""
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip().rstrip(".")


def _get_file_path(
    vault_path: str,
    project_name: str | None,
    source_id: str | None = None,
) -> str:
    if source_id:
        return os.path.join(vault_path, source_id, "TODO.md")
    if project_name:
        return os.path.join(vault_path, _sanitize_name(project_name), "TODO.md")
    return os.path.join(vault_path, "00_Inbox", "TODO.md")


def _todo_to_md_line(todo: Todo) -> str:
    marker = "x" if todo.status == "completed" else " "
    parts = [f"- [{marker}] {todo.title}"]

    if todo.due_date:
        parts.append(f"@due({todo.due_date.strftime('%Y-%m-%d')})")
    if todo.completed_at:
        parts.append(f"@completed({todo.completed_at.strftime('%Y-%m-%d')})")
    if todo.priority and todo.priority not in ("medium", ""):
        parts.append(f"@{todo.priority}")

    tags = deserialize_tags(todo.tags) if todo.tags else []
    for tag in tags:
        if not tag.startswith("#"):
            tag = f"#{tag}"
        parts.append(tag)

    # Skill-based export (preferred) or legacy agent export.
    if todo.enabled_skills:
        import json as _json
        try:
            skills_list = _json.loads(todo.enabled_skills) if isinstance(todo.enabled_skills, str) else todo.enabled_skills
            if skills_list:
                parts.append(f"@skills({','.join(skills_list)})")
        except (ValueError, TypeError):
            pass
    elif todo.assignee:
        _AGENT_ROLES = {"planner", "researcher", "executor", "openclaw"}
        if todo.assignee in _AGENT_ROLES:
            parts.append(f"@agent({todo.assignee})")

    parts.append(f"<!-- claw:{todo.id} -->")
    return " ".join(parts)


def _read_lines(path: str) -> list[str]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return f.readlines()


def _write_lines(path: str, lines: list[str]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def _upsert_line(path: str, todo_id: str, new_line: str) -> None:
    """Insert or update a single todo line in *path*."""
    lines = _read_lines(path)

    # Try to find an existing line for this todo.
    for i, line in enumerate(lines):
        m = _MARKER_RE.search(line)
        if m and m.group(1) == todo_id:
            lines[i] = new_line + "\n"
            _write_lines(path, lines)
            return

    # Not found — append under the ClawChat section header.
    _ensure_section_header(path, lines)
    lines = _read_lines(path)  # re-read after possible header insertion

    # Find the section header and insert after it.
    insert_idx = len(lines)
    for i, line in enumerate(lines):
        if line.strip() == _SECTION_HEADER:
            insert_idx = i + 1
            break

    lines.insert(insert_idx, new_line + "\n")
    _write_lines(path, lines)


def _remove_line(path: str, todo_id: str) -> bool:
    """Remove the line for *todo_id* from *path*.  Returns True if found."""
    lines = _read_lines(path)
    for i, line in enumerate(lines):
        m = _MARKER_RE.search(line)
        if m and m.group(1) == todo_id:
            del lines[i]
            _write_lines(path, lines)
            return True
    return False


def _remove_all_markers(vault_path: str, todo_id: str) -> None:
    """Walk the entire vault and remove any line containing the marker for *todo_id*.

    This prevents duplicate entries when a todo moves between folders.
    """
    for dirpath, _dirs, filenames in os.walk(vault_path):
        for fname in filenames:
            if not fname.endswith(".md"):
                continue
            abs_path = os.path.join(dirpath, fname)
            _remove_line(abs_path, todo_id)


def _ensure_section_header(path: str, lines: list[str]) -> None:
    """Add the ``## ClawChat`` section header if it is missing."""
    for line in lines:
        if line.strip() == _SECTION_HEADER:
            return

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        if lines and not lines[-1].endswith("\n"):
            f.write("\n")
        f.write(f"\n{_SECTION_HEADER}\n")


def _export_group(path: str, todos: list[Todo]) -> None:
    """Replace all exported lines in *path* and append missing ones."""
    lines = _read_lines(path)

    # Index existing marker lines by todo id.
    existing: dict[str, int] = {}
    for i, line in enumerate(lines):
        m = _MARKER_RE.search(line)
        if m:
            existing[m.group(1)] = i

    # Update existing lines and collect new ones.
    new_todos: list[str] = []
    for todo in todos:
        md = _todo_to_md_line(todo)
        if todo.id in existing:
            lines[existing[todo.id]] = md + "\n"
        else:
            new_todos.append(md)

    # Append new todos under the section header.
    if new_todos:
        _ensure_section_header(path, lines)
        lines = _read_lines(path) if not lines else lines
        # Re-scan for header position after possible insertion.
        insert_idx = len(lines)
        for i, line in enumerate(lines):
            if line.strip() == _SECTION_HEADER:
                insert_idx = i + 1
                break
        for md in new_todos:
            lines.insert(insert_idx, md + "\n")
            insert_idx += 1

    _write_lines(path, lines)


# ---------------------------------------------------------------------------
# CLI-aware helpers
# ---------------------------------------------------------------------------


def _create_file_via_cli_or_fs(vault_path: str, abs_path: str) -> None:
    """Create a new file, preferring CLI for Obsidian metadata tracking."""
    try:
        from services import obsidian_cli_service as cli_svc

        rel_path = os.path.relpath(abs_path, vault_path)
        if cli_svc.create_document(rel_path, f"{_SECTION_HEADER}\n", queue_on_fail=False):
            return
    except ImportError:
        pass

    # Filesystem fallback — just ensure the directory exists.
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)


def move_todo_in_vault(
    vault_path: str,
    todo_id: str,
    old_project: str | None,
    new_project: str | None,
    source_id: str | None = None,
) -> None:
    """Move a todo's vault file when its project changes.

    Uses CLI move when available (preserves internal links) and falls back
    to a remove-then-export cycle otherwise.
    """
    old_path = _get_file_path(vault_path, old_project, source_id=None)
    new_path = _get_file_path(vault_path, new_project, source_id=source_id)

    if old_path == new_path:
        return

    # Remove from old location first.
    _remove_line(old_path, todo_id)

    # The new location will be written on the next export_todo call.


# ---------------------------------------------------------------------------
# Last-export timestamp (in-memory; resets on restart)
# ---------------------------------------------------------------------------

_last_export_time: datetime | None = None


def get_last_export_time() -> datetime | None:
    return _last_export_time


def set_last_export_time(dt: datetime) -> None:
    global _last_export_time
    _last_export_time = dt
