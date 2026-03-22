"""Obsidian vault integration endpoints.

Provides export/sync, project listing, health checks, vault scanning,
write queue management, dead letter queue, CLI error log, and reindexing.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from config import settings
from database import get_db
from models.todo import Todo
from services.obsidian_export_service import (
    export_all_todos,
    get_last_export_time,
    set_last_export_time,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Export / sync
# ---------------------------------------------------------------------------


@router.post("/sync")
async def trigger_export(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Export all todos from the DB to the Obsidian vault."""
    vault_path = settings.obsidian_vault_path
    if not vault_path:
        return {"error": "Obsidian vault path not configured", "exported": 0}

    stmt = select(Todo)
    todos = list((await db.execute(stmt)).scalars().all())

    result = export_all_todos(vault_path, todos)
    set_last_export_time(datetime.now(timezone.utc))

    return {
        "exported": result.exported,
        "file_count": result.file_count,
        "errors": result.errors,
    }


# ---------------------------------------------------------------------------
# Status & health
# ---------------------------------------------------------------------------


@router.get("/status")
async def get_status(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Return current Obsidian export status."""
    vault_path = settings.obsidian_vault_path
    enabled = bool(vault_path)

    stmt = select(func.count(Todo.id))
    db_task_count = (await db.execute(stmt)).scalar() or 0

    last_export = get_last_export_time()

    cli_command = settings.obsidian_cli_command
    cli_available = bool(cli_command)

    return {
        "enabled": enabled,
        "vault_path": vault_path,
        "last_sync": last_export.isoformat() if last_export else None,
        "db_task_count": db_task_count,
        "cli_available": cli_available,
        "mode": "cli" if cli_available else ("filesystem" if enabled else "disabled"),
    }


@router.get("/health")
async def get_health(
    _user: str = Depends(get_current_user),
):
    """Comprehensive vault health check.

    Returns vault availability, CLI status, companion node state,
    index freshness, write queue status, and sync status.
    """
    from services.obsidian_vault_indexer import get_health_summary
    from services.obsidian_cli_service import get_queue_status
    from services.vault_watcher_service import get_sync_status

    health = get_health_summary()
    health["write_queue"] = get_queue_status()
    health["bidirectional_sync"] = get_sync_status()
    return health


# ---------------------------------------------------------------------------
# Project listing
# ---------------------------------------------------------------------------


@router.get("/projects")
async def list_projects(
    _user: str = Depends(get_current_user),
):
    """List project folders with cached metadata from the vault index."""
    from services.obsidian_vault_indexer import ensure_fresh

    idx = ensure_fresh()
    projects = []
    for entry in sorted(idx.projects.values(), key=lambda e: e.name.lower()):
        projects.append({
            "folder": entry.folder,
            "name": entry.name,
            "todo_md_preview": entry.todo_md_preview,
            "doc_count": len(entry.doc_summaries),
            "last_modified": entry.last_modified or None,
        })

    return {
        "projects": projects,
        "total": len(projects),
        "index_age_seconds": (
            round((__import__("time").time() - idx.last_full_scan), 1)
            if idx.last_full_scan
            else None
        ),
    }


@router.get("/projects/{folder:path}/context")
async def get_project_context(
    folder: str,
    _user: str = Depends(get_current_user),
):
    """Read TODO.md and related documents for a project folder."""
    from services.obsidian_context_service import read_project_context

    vault_path = settings.obsidian_vault_path
    if not vault_path:
        return {"error": "Vault not configured"}

    ctx = read_project_context(vault_path, folder, settings.obsidian_cli_command)
    return ctx


# ---------------------------------------------------------------------------
# Index management
# ---------------------------------------------------------------------------


@router.post("/reindex")
async def trigger_reindex(
    _user: str = Depends(get_current_user),
):
    """Force a full vault index refresh."""
    from services.obsidian_vault_indexer import refresh_index

    idx = refresh_index()
    return {
        "project_count": len(idx.projects),
        "scan_duration_ms": idx.scan_duration_ms,
        "vault_available": idx.is_available,
        "cli_available": idx.cli_available,
        "companion_online": idx.companion_online,
    }


# ---------------------------------------------------------------------------
# Write queue
# ---------------------------------------------------------------------------


@router.get("/queue")
async def get_write_queue(
    _user: str = Depends(get_current_user),
):
    """Return pending write queue operations."""
    from services.obsidian_cli_service import get_queue_status

    return get_queue_status()


@router.post("/queue/flush")
async def flush_write_queue(
    _user: str = Depends(get_current_user),
):
    """Attempt to replay all queued write operations."""
    from services.obsidian_cli_service import flush_queue

    return flush_queue()


@router.delete("/queue")
async def clear_write_queue(
    _user: str = Depends(get_current_user),
):
    """Clear all queued write operations."""
    from services.obsidian_cli_service import clear_queue

    cleared = clear_queue()
    return {"cleared": cleared}


# ---------------------------------------------------------------------------
# Dead letter queue
# ---------------------------------------------------------------------------


@router.get("/dead-letter")
async def get_dead_letter(
    _user: str = Depends(get_current_user),
):
    """Return dead letter queue (operations that exceeded max retries)."""
    from services.obsidian_cli_service import get_dead_letter_status

    return get_dead_letter_status()


@router.post("/dead-letter/retry")
async def retry_dead_letter_queue(
    _user: str = Depends(get_current_user),
):
    """Move all dead letter items back to the main queue with reset retries."""
    from services.obsidian_cli_service import retry_dead_letter

    requeued = retry_dead_letter()
    return {"requeued": requeued}


@router.delete("/dead-letter")
async def clear_dead_letter_queue(
    _user: str = Depends(get_current_user),
):
    """Clear all dead letter operations."""
    from services.obsidian_cli_service import clear_dead_letter

    cleared = clear_dead_letter()
    return {"cleared": cleared}


# ---------------------------------------------------------------------------
# CLI error log
# ---------------------------------------------------------------------------


@router.get("/cli-errors")
async def get_cli_errors(
    _user: str = Depends(get_current_user),
):
    """Return recent CLI error log (up to 50 entries, newest first)."""
    from services.obsidian_cli_service import get_cli_error_log

    errors = get_cli_error_log()
    return {"errors": errors, "total": len(errors)}


# ---------------------------------------------------------------------------
# Bidirectional sync
# ---------------------------------------------------------------------------


@router.post("/scan")
async def trigger_vault_scan(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Scan the vault for external changes and sync them to the database."""
    from services.vault_watcher_service import scan_vault

    result = await scan_vault(db)
    return {
        "files_scanned": result.files_scanned,
        "markers_found": result.markers_found,
        "changes_detected": result.changes_detected,
        "changes_applied": result.changes_applied,
        "errors": result.errors,
        "duration_ms": result.duration_ms,
    }


@router.get("/sync-status")
async def get_sync_status_endpoint(
    _user: str = Depends(get_current_user),
):
    """Return bidirectional sync status."""
    from services.vault_watcher_service import get_sync_status

    return get_sync_status()


# ---------------------------------------------------------------------------
# CLI commands (discovery)
# ---------------------------------------------------------------------------


@router.get("/cli-commands")
async def list_cli_commands(
    _user: str = Depends(get_current_user),
):
    """List available Obsidian CLI plugin commands."""
    from services.obsidian_cli_service import list_cli_commands

    commands = list_cli_commands()
    return {"commands": commands, "total": len(commands)}


@router.post("/cli-commands/{command_id}")
async def execute_cli_command(
    command_id: str,
    _user: str = Depends(get_current_user),
):
    """Execute a specific Obsidian CLI plugin command."""
    from services.obsidian_cli_service import _run_cli

    result = _run_cli("command", f"id={command_id}")
    if result is None:
        return {"success": False, "error": "CLI command failed or not available"}
    return {"success": True, "output": result.stdout.strip()}
