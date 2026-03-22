"""Vault watcher — scans the Obsidian vault for external changes and syncs
them back to the ClawChat database.

Only watches:
- ``TODO.md`` files that contain ``<!-- claw:... -->`` markers
- Documents created by ClawChat agents (identified by ``task_id`` frontmatter)

This is NOT a real-time watcher (no inotify/fswatch); it is a periodic scanner
invoked by the scheduler or on demand via API.
"""

import hashlib
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.todo import Todo
from utils import deserialize_tags, serialize_tags

logger = logging.getLogger(__name__)

# Regex patterns for parsing vault markers and metadata
_MARKER_RE = re.compile(r"<!--\s*claw:(\S+)\s*-->")
_CHECKBOX_RE = re.compile(r"^- \[([ xX])\] (.+?)(?:\s*<!--\s*claw:\S+\s*-->)?\s*$")
_DUE_RE = re.compile(r"@due\((\d{4}-\d{2}-\d{2})\)")
_PRIORITY_RE = re.compile(r"@(urgent|high|low)")
_TAG_RE = re.compile(r"#(\w[\w/-]*)")
_COMPLETED_RE = re.compile(r"@completed\((\d{4}-\d{2}-\d{2})\)")
_AGENT_RE = re.compile(r"@agent\((\w+)\)")
_SKILLS_RE = re.compile(r"@skills\(([^)]+)\)")


@dataclass
class SyncChange:
    """A single detected change."""
    todo_id: str
    field: str
    old_value: str | None
    new_value: str | None
    source_file: str


@dataclass
class ScanResult:
    """Result of a vault scan."""
    files_scanned: int = 0
    markers_found: int = 0
    changes_detected: int = 0
    changes_applied: int = 0
    errors: int = 0
    changes: list[SyncChange] = field(default_factory=list)
    duration_ms: float = 0.0
    scanned_at: float = 0.0


# Module-level state
_last_scan: ScanResult | None = None
_file_hashes: dict[str, str] = {}  # path -> content hash for change detection
_scan_in_progress: bool = False
_last_scan_start: float = 0.0

_STUCK_TIMEOUT = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def scan_vault(db: AsyncSession) -> ScanResult:
    """Scan the vault for external changes and sync them to the database.

    Returns a ScanResult with details of what was found and applied.
    """
    global _last_scan, _scan_in_progress, _last_scan_start

    vault_path = settings.obsidian_vault_path
    if not vault_path or not os.path.isdir(vault_path):
        return ScanResult(errors=1)

    _scan_in_progress = True
    _last_scan_start = time.monotonic()
    start = time.monotonic()
    result = ScanResult(scanned_at=time.time())

    try:
        result = await _do_scan(db, vault_path, result)
    finally:
        _scan_in_progress = False

    result.duration_ms = round((time.monotonic() - start) * 1000, 1)
    _last_scan = result

    if result.changes_applied:
        logger.info(
            "Vault scan: %d files, %d markers, %d changes applied in %.0fms",
            result.files_scanned,
            result.markers_found,
            result.changes_applied,
            result.duration_ms,
        )
    else:
        logger.debug(
            "Vault scan: %d files, %d markers, no changes (%.0fms)",
            result.files_scanned,
            result.markers_found,
            result.duration_ms,
        )

    return result


async def _do_scan(
    db: AsyncSession, vault_path: str, result: ScanResult
) -> ScanResult:
    """Core scan logic, separated for clean try/finally in caller."""
    # Find all TODO.md files in the vault
    todo_files: list[str] = []
    todo_filename = settings.obsidian_project_todo_filename

    for dirpath, _dirs, filenames in os.walk(vault_path):
        # Skip .obsidian and other hidden directories
        if any(part.startswith(".") for part in dirpath.split(os.sep)):
            continue
        for fname in filenames:
            if fname == todo_filename:
                todo_files.append(os.path.join(dirpath, fname))

    # Also check the inbox
    inbox_todo = os.path.join(vault_path, "00_Inbox", todo_filename)
    if os.path.isfile(inbox_todo) and inbox_todo not in todo_files:
        todo_files.append(inbox_todo)

    result.files_scanned = len(todo_files)

    # Parse each file for claw markers
    all_markers: dict[str, dict] = {}  # todo_id -> parsed data

    for fpath in todo_files:
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except OSError:
            result.errors += 1
            continue

        # File hash check — skip unchanged files
        content_hash = hashlib.md5(content.encode()).hexdigest()
        if _file_hashes.get(fpath) == content_hash:
            continue
        _file_hashes[fpath] = content_hash

        rel_path = os.path.relpath(fpath, vault_path)

        for line in content.splitlines():
            marker_match = _MARKER_RE.search(line)
            if not marker_match:
                continue

            todo_id = marker_match.group(1)
            if todo_id.startswith("progress:"):
                continue  # Skip progress markers

            result.markers_found += 1
            parsed = _parse_todo_line(line)
            parsed["source_file"] = rel_path
            all_markers[todo_id] = parsed

    # Compare with database and apply changes
    if all_markers:
        todo_ids = list(all_markers.keys())
        stmt = select(Todo).where(Todo.id.in_(todo_ids))
        db_todos = {t.id: t for t in (await db.execute(stmt)).scalars().all()}

        for todo_id, vault_data in all_markers.items():
            db_todo = db_todos.get(todo_id)
            if not db_todo:
                continue

            changes = _diff_todo(db_todo, vault_data)
            for change in changes:
                change.source_file = vault_data["source_file"]
                result.changes.append(change)
                result.changes_detected += 1

                try:
                    _apply_change(db_todo, change)
                    result.changes_applied += 1
                except Exception:
                    logger.warning(
                        "Failed to apply change %s=%s for todo %s",
                        change.field,
                        change.new_value,
                        todo_id,
                        exc_info=True,
                    )
                    result.errors += 1

        if result.changes_applied > 0:
            try:
                await db.commit()
            except Exception:
                logger.exception("Failed to commit vault sync changes")
                await db.rollback()
                result.errors += result.changes_applied
                result.changes_applied = 0

    return result


def get_sync_status() -> dict:
    """Return the current sync status for API responses."""
    scan = _last_scan
    if not scan:
        return {
            "last_scan": None,
            "files_scanned": 0,
            "markers_found": 0,
            "changes_applied": 0,
            "errors": 0,
            "sync_lag_seconds": None,
            "scan_in_progress": _scan_in_progress,
            "scan_stuck": is_scan_stuck(),
        }

    lag = time.time() - scan.scanned_at if scan.scanned_at else None

    return {
        "last_scan": scan.scanned_at,
        "files_scanned": scan.files_scanned,
        "markers_found": scan.markers_found,
        "changes_detected": scan.changes_detected,
        "changes_applied": scan.changes_applied,
        "errors": scan.errors,
        "duration_ms": scan.duration_ms,
        "sync_lag_seconds": round(lag, 1) if lag else None,
        "scan_in_progress": _scan_in_progress,
        "scan_stuck": is_scan_stuck(),
        "recent_changes": [
            {
                "todo_id": c.todo_id,
                "field": c.field,
                "old_value": c.old_value,
                "new_value": c.new_value,
                "source_file": c.source_file,
            }
            for c in (scan.changes or [])[:20]
        ],
    }


def get_sync_lag() -> float | None:
    """Return seconds since last scan, or None if never scanned."""
    if not _last_scan or not _last_scan.scanned_at:
        return None
    return time.time() - _last_scan.scanned_at


def is_scan_stuck(timeout_seconds: int = _STUCK_TIMEOUT) -> bool:
    """Return True if a scan has been running longer than timeout."""
    if not _scan_in_progress:
        return False
    return (time.monotonic() - _last_scan_start) > timeout_seconds


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def _parse_todo_line(line: str) -> dict:
    """Parse a markdown todo line into a dict of field values."""
    result: dict = {}

    # Status (checkbox)
    cb_match = _CHECKBOX_RE.match(line.strip())
    if cb_match:
        marker = cb_match.group(1)
        result["status"] = "completed" if marker.lower() == "x" else "pending"
        result["title"] = cb_match.group(2).strip()
        # Clean metadata from title
        title = result["title"]
        for pattern in [_DUE_RE, _PRIORITY_RE, _COMPLETED_RE, _AGENT_RE, _SKILLS_RE, _TAG_RE, _MARKER_RE]:
            title = pattern.sub("", title)
        result["title"] = title.strip()

    # Due date
    due_match = _DUE_RE.search(line)
    if due_match:
        result["due_date"] = due_match.group(1)

    # Priority
    pri_match = _PRIORITY_RE.search(line)
    if pri_match:
        result["priority"] = pri_match.group(1)

    # Tags
    tags = _TAG_RE.findall(line)
    if tags:
        result["tags"] = tags

    # Completed date
    comp_match = _COMPLETED_RE.search(line)
    if comp_match:
        result["completed_at"] = comp_match.group(1)

    # Skills (preferred) or legacy agent
    skills_match = _SKILLS_RE.search(line)
    if skills_match:
        import json as _json
        skills_csv = skills_match.group(1).strip()
        skills_list = [s.strip() for s in skills_csv.split(",") if s.strip()]
        result["enabled_skills"] = _json.dumps(skills_list)
        result["assignee"] = skills_list[0] if skills_list else None
    else:
        agent_match = _AGENT_RE.search(line)
        if agent_match:
            result["assignee"] = agent_match.group(1)

    return result


def _diff_todo(db_todo: Todo, vault_data: dict) -> list[SyncChange]:
    """Compare a database todo with vault data and return changes."""
    changes: list[SyncChange] = []

    # Status
    vault_status = vault_data.get("status")
    if vault_status and vault_status != db_todo.status:
        changes.append(SyncChange(
            todo_id=db_todo.id,
            field="status",
            old_value=db_todo.status,
            new_value=vault_status,
            source_file="",
        ))

    # Due date
    vault_due = vault_data.get("due_date")
    db_due = db_todo.due_date.strftime("%Y-%m-%d") if db_todo.due_date else None
    if vault_due and vault_due != db_due:
        changes.append(SyncChange(
            todo_id=db_todo.id,
            field="due_date",
            old_value=db_due,
            new_value=vault_due,
            source_file="",
        ))

    # Priority
    vault_priority = vault_data.get("priority")
    if vault_priority and vault_priority != db_todo.priority:
        changes.append(SyncChange(
            todo_id=db_todo.id,
            field="priority",
            old_value=db_todo.priority,
            new_value=vault_priority,
            source_file="",
        ))

    # Tags
    vault_tags = vault_data.get("tags")
    if vault_tags:
        db_tags = deserialize_tags(db_todo.tags) if db_todo.tags else []
        if set(vault_tags) != set(db_tags):
            changes.append(SyncChange(
                todo_id=db_todo.id,
                field="tags",
                old_value=str(db_tags),
                new_value=str(vault_tags),
                source_file="",
            ))

    # Enabled skills (from @skills(...) in vault)
    vault_enabled_skills = vault_data.get("enabled_skills")
    if vault_enabled_skills and vault_enabled_skills != db_todo.enabled_skills:
        changes.append(SyncChange(
            todo_id=db_todo.id,
            field="enabled_skills",
            old_value=db_todo.enabled_skills,
            new_value=vault_enabled_skills,
            source_file="",
        ))

    # Assignee (legacy or derived from @skills)
    vault_assignee = vault_data.get("assignee")
    if vault_assignee and vault_assignee != db_todo.assignee:
        changes.append(SyncChange(
            todo_id=db_todo.id,
            field="assignee",
            old_value=db_todo.assignee,
            new_value=vault_assignee,
            source_file="",
        ))

    return changes


def _apply_change(todo: Todo, change: SyncChange) -> None:
    """Apply a single change to a Todo model instance."""
    if change.field == "status":
        todo.status = change.new_value
        if change.new_value == "completed" and not todo.completed_at:
            todo.completed_at = datetime.now(timezone.utc)
        elif change.new_value == "pending":
            todo.completed_at = None

    elif change.field == "due_date":
        if change.new_value:
            todo.due_date = datetime.strptime(change.new_value, "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            )
        else:
            todo.due_date = None

    elif change.field == "priority":
        todo.priority = change.new_value

    elif change.field == "tags":
        # Parse the vault tags from the string representation
        import ast
        try:
            tag_list = ast.literal_eval(change.new_value) if change.new_value else []
        except (ValueError, SyntaxError):
            tag_list = []
        todo.tags = serialize_tags(tag_list)

    elif change.field == "assignee":
        todo.assignee = change.new_value

    elif change.field == "enabled_skills":
        todo.enabled_skills = change.new_value

    todo.updated_at = datetime.now(timezone.utc)
