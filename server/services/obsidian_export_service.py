"""One-way export of ClawChat todos to Obsidian vault markdown files.

Uses the Obsidian CLI service for new file creation and document moves
(to preserve internal links), falling back to direct filesystem writes
for line-level upserts within managed ``## ClawChat`` sections.
"""

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime

from domain.task import TaskStatus
from models.todo import Todo
from utils import deserialize_tags
from utils.atomic_files import atomic_write_lines, synchronized_path
from utils.vault_paths import VaultPathError, resolve_vault_path

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


@dataclass(frozen=True, slots=True)
class TodoSnapshot:
    """The todo fields the vault export reads, detached from any ORM session.

    Every async caller hands the export to ``asyncio.to_thread``.  Passing a
    session-bound ``Todo`` across that boundary is a latent ``MissingGreenlet``:
    the worker thread has no greenlet context, so the moment an attribute it
    touches is expired -- which is exactly what happens if a session factory is
    ever built with ``expire_on_commit=True`` -- the lazy load raises from a
    thread that cannot recover.  Callers snapshot on the event loop thread,
    while the attributes are guaranteed loaded, and the worker only ever sees
    plain values.

    ``export_todo``/``export_todos_batch``/``export_all_todos`` still accept a
    ``Todo`` so synchronous callers are unaffected; they normalise on entry.
    """

    id: str
    title: str
    status: str
    priority: str | None
    due_date: datetime | None
    completed_at: datetime | None
    tags: str | None
    enabled_skills: str | None
    assignee: str | None
    source_id: str | None
    parent_id: str | None


def snapshot_todo(todo: "Todo | TodoSnapshot") -> TodoSnapshot:
    """Freeze the export-visible fields of *todo* into a session-free value.

    Call this on the event loop thread, before ``asyncio.to_thread``.  Passing
    a ``TodoSnapshot`` back in is a no-op, so normalising twice is harmless.
    """
    if isinstance(todo, TodoSnapshot):
        return todo
    return TodoSnapshot(
        id=todo.id,
        title=todo.title,
        status=todo.status,
        priority=todo.priority,
        due_date=todo.due_date,
        completed_at=todo.completed_at,
        tags=todo.tags,
        enabled_skills=todo.enabled_skills,
        assignee=todo.assignee,
        source_id=todo.source_id,
        parent_id=todo.parent_id,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def export_todo(
    vault_path: str,
    todo: Todo | TodoSnapshot,
    project_name: str | None = None,
) -> None:
    """Export a single todo to the Obsidian vault (create or update).

    For new files that don't yet exist, tries CLI creation first (so the
    document is tracked by Obsidian metadata).  Line-level upserts within
    existing files use direct filesystem writes.
    """
    try:
        export_todos_batch(vault_path, [(todo, project_name)])
    except Exception:
        logger.exception("Failed to export todo %s to vault", todo.id)


def remove_todo_from_vault(vault_path: str, todo_id: str) -> None:
    """Remove a todo line from all markdown files in the vault."""
    try:
        for dirpath, _dirs, filenames in os.walk(vault_path):
            for fname in filenames:
                if not fname.endswith(".md"):
                    continue
                relative_path = os.path.relpath(os.path.join(dirpath, fname), vault_path)
                try:
                    abs_path = resolve_vault_path(
                        vault_path, relative_path, must_exist=True
                    )
                except VaultPathError:
                    logger.warning("Skipping markdown path outside vault: %s", relative_path)
                    continue
                if _remove_line(abs_path, todo_id):
                    return
    except Exception:
        logger.exception("Failed to remove todo %s from vault", todo_id)


def remove_todos_from_vault(vault_path: str, todo_ids: set[str]) -> None:
    """Remove multiple todo lines with one vault pass."""
    try:
        _remove_markers_from_vault(vault_path, todo_ids)
    except Exception:
        logger.exception("Failed to remove %d todos from vault", len(todo_ids))


def export_all_todos(vault_path: str, todos: list[Todo | TodoSnapshot]) -> ExportResult:
    """Full export of all todos to the vault.

    Groups todos by project (parent title) and writes each group to its own
    file.  Existing ``<!-- claw:... -->`` lines are replaced; new ones are
    appended under a ``## ClawChat`` section header.
    """
    # Build a parent-id → title lookup.
    todos = [snapshot_todo(todo) for todo in todos]
    parent_titles: dict[str, str] = {}
    for t in todos:
        if t.parent_id is None:
            parent_titles[t.id] = t.title

    items = [
        (
            todo,
            None
            if todo.source_id
            else parent_titles.get(todo.parent_id) if todo.parent_id else None,
        )
        for todo in todos
    ]
    return export_todos_batch(vault_path, items)


def export_todos_batch(
    vault_path: str,
    items: list[tuple[Todo | TodoSnapshot, str | None]],
    *,
    remove_existing: bool = True,
) -> ExportResult:
    """Export multiple todos while scanning each vault file only once."""
    result = ExportResult()
    if not items:
        return result

    items = [(snapshot_todo(todo), project_name) for todo, project_name in items]

    if remove_existing:
        _remove_markers_from_vault(vault_path, {todo.id for todo, _ in items})

    grouped: dict[str, list[TodoSnapshot]] = {}
    for todo, project_name in items:
        try:
            abs_path = _get_file_path(
                vault_path, project_name, source_id=todo.source_id
            )
        except VaultPathError:
            logger.warning(
                "Rejected unsafe vault source_id for todo %s: %r",
                todo.id,
                todo.source_id,
            )
            result.errors += 1
            continue
        grouped.setdefault(abs_path, []).append(todo)

    for abs_path, group in grouped.items():
        try:
            with synchronized_path(abs_path):
                if not os.path.isfile(abs_path):
                    _create_file_via_cli_or_fs(vault_path, abs_path)
                _export_group(abs_path, group)
            result.exported += len(group)
            result.file_count += 1
        except Exception:
            logger.exception("Failed to export group to %s", abs_path)
            result.errors += len(group)

    return result


def reconcile_todos_in_vault(
    vault_path: str,
    items: list[tuple[Todo | TodoSnapshot, str | None]],
    removed_todo_ids: set[str],
) -> ExportResult:
    """Strictly reconcile managed markers for an outbox delivery.

    Unlike the legacy convenience wrappers, this function lets filesystem
    failures propagate so a durable outbox job can record and retry them.
    User-authored files and directories are never removed.
    """
    active_ids = {todo.id for todo, _project_name in items}
    _remove_markers_from_vault(vault_path, active_ids | removed_todo_ids)
    result = export_todos_batch(vault_path, items, remove_existing=False)
    if result.errors:
        raise RuntimeError(
            f"Failed to export {result.errors} todo marker(s) to the vault"
        )
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
        return resolve_vault_path(vault_path, f"{source_id}/TODO.md")
    if project_name:
        return resolve_vault_path(
            vault_path, f"{_sanitize_name(project_name)}/TODO.md"
        )
    return resolve_vault_path(vault_path, "00_Inbox/TODO.md")


def _todo_to_md_line(todo: TodoSnapshot) -> str:
    marker = "x" if todo.status == TaskStatus.COMPLETED else " "
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
            skills_list = (
                _json.loads(todo.enabled_skills)
                if isinstance(todo.enabled_skills, str)
                else todo.enabled_skills
            )
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
    with synchronized_path(path):
        atomic_write_lines(path, lines)


def _remove_line(path: str, todo_id: str) -> bool:
    """Remove the line for *todo_id* from *path*.  Returns True if found."""
    with synchronized_path(path):
        lines = _read_lines(path)
        for i, line in enumerate(lines):
            m = _MARKER_RE.search(line)
            if m and m.group(1) == todo_id:
                del lines[i]
                _write_lines(path, lines)
                return True
    return False


def _remove_markers_from_vault(vault_path: str, todo_ids: set[str]) -> None:
    """Remove multiple todo markers with one pass over the vault."""
    if not todo_ids:
        return

    for dirpath, _dirs, filenames in os.walk(vault_path):
        for fname in filenames:
            if not fname.endswith(".md"):
                continue
            relative_path = os.path.relpath(os.path.join(dirpath, fname), vault_path)
            try:
                abs_path = resolve_vault_path(
                    vault_path, relative_path, must_exist=True
                )
            except VaultPathError:
                logger.warning("Skipping markdown path outside vault: %s", relative_path)
                continue
            with synchronized_path(abs_path):
                lines = _read_lines(abs_path)
                filtered: list[str] = []
                changed = False
                for line in lines:
                    marker = _MARKER_RE.search(line)
                    if marker and marker.group(1) in todo_ids:
                        changed = True
                        continue
                    filtered.append(line)
                if changed:
                    _write_lines(abs_path, filtered)


def _ensure_section_header(lines: list[str]) -> None:
    """Add the ``## ClawChat`` section header if it is missing."""
    for line in lines:
        if line.strip() == _SECTION_HEADER:
            return

    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    if lines:
        lines.append("\n")
    lines.append(f"{_SECTION_HEADER}\n")


def _export_group(path: str, todos: list[TodoSnapshot]) -> None:
    """Replace all exported lines in *path* and append missing ones."""
    with synchronized_path(path):
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
            _ensure_section_header(lines)
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
