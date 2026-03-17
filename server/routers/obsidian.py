"""Obsidian vault export endpoints."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
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

    return {
        "enabled": enabled,
        "vault_path": vault_path,
        "last_sync": last_export.isoformat() if last_export else None,
        "db_task_count": db_task_count,
    }
