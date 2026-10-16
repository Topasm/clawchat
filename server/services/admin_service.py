"""Admin dashboard service functions."""

import asyncio
import os
import sqlite3
import time
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import rebuild_fts
from domain.task import TaskStatus
from models.conversation import Conversation
from models.message import Message
from models.todo import Todo
from models.event import Event
from models.agent_task import AgentTask
from models.attachment import Attachment
from services.tasks import task_relationship_service

logger = logging.getLogger(__name__)

_start_time = time.time()


async def get_table_counts(db: AsyncSession) -> dict[str, int]:
    """Return row counts for all main tables."""
    tables = {
        "conversations": Conversation,
        "messages": Message,
        "todos": Todo,
        "events": Event,
        "agent_tasks": AgentTask,
        "attachments": Attachment,
    }
    counts = {}
    for name, model in tables.items():
        result = await db.execute(select(func.count(model.id)))
        counts[name] = result.scalar() or 0
    return counts


async def get_storage_stats(db: AsyncSession) -> dict:
    """Return DB file size, upload dir size, attachment stats."""
    db_path = settings.database_url.split("///")[-1]
    db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0

    upload_size = 0
    if os.path.isdir(settings.upload_dir):
        for dirpath, _, filenames in os.walk(settings.upload_dir):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                upload_size += os.path.getsize(fp)

    result = await db.execute(
        select(func.count(Attachment.id), func.coalesce(func.sum(Attachment.size_bytes), 0))
    )
    row = result.one()

    return {
        "db_size_bytes": db_size,
        "upload_dir_size_bytes": upload_size,
        "attachment_count": row[0],
        "attachment_total_bytes": row[1],
    }


def get_uptime_seconds() -> float:
    return time.time() - _start_time


async def get_recent_activity(db: AsyncSession, limit: int = 50) -> list[dict]:
    """Fetch recent messages, todos, events, memos ordered by created_at desc."""
    items: list[dict] = []

    msgs = (await db.execute(
        select(Message).order_by(Message.created_at.desc()).limit(limit)
    )).scalars().all()
    for m in msgs:
        items.append({
            "type": "message",
            "id": m.id,
            "summary": (m.content or "")[:120],
            "created_at": m.created_at.isoformat(),
        })

    todos = (await db.execute(
        select(Todo).order_by(Todo.created_at.desc()).limit(limit)
    )).scalars().all()
    for t in todos:
        items.append({
            "type": "todo",
            "id": t.id,
            "summary": (t.title or "")[:120],
            "created_at": t.created_at.isoformat(),
        })

    events = (await db.execute(
        select(Event).order_by(Event.created_at.desc()).limit(limit)
    )).scalars().all()
    for e in events:
        items.append({
            "type": "event",
            "id": e.id,
            "summary": (e.title or "")[:120],
            "created_at": e.created_at.isoformat(),
        })

    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[:limit]


async def get_agent_task_history(db: AsyncSession, limit: int = 50) -> list[dict]:
    """Fetch completed/failed agent tasks."""
    tasks = (await db.execute(
        select(AgentTask)
        .where(AgentTask.status.in_(["completed", "failed"]))
        .order_by(AgentTask.completed_at.desc())
        .limit(limit)
    )).scalars().all()

    return [
        {
            "id": t.id,
            "task_type": t.task_type,
            "agent_type": t.agent_type or "general",
            "skill_chain": t.skill_chain,
            "status": t.status,
            "instruction": (t.instruction or "")[:200],
            "result": (t.result[:200] if t.result else None),
            "error": t.error,
            "created_at": t.created_at.isoformat(),
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        }
        for t in tasks
    ]


async def get_module_data_overview(db: AsyncSession) -> list[dict]:
    """Per-module data overview with count and date ranges."""
    modules = [
        ("conversations", Conversation, Conversation.created_at),
        ("messages", Message, Message.created_at),
        ("todos", Todo, Todo.created_at),
        ("events", Event, Event.created_at),
    ]
    result = []
    for name, model, date_col in modules:
        count = (await db.execute(select(func.count(model.id)))).scalar() or 0
        oldest = None
        newest = None
        if count > 0:
            oldest_dt = (await db.execute(select(func.min(date_col)))).scalar()
            newest_dt = (await db.execute(select(func.max(date_col)))).scalar()
            oldest = oldest_dt.isoformat() if oldest_dt else None
            newest = newest_dt.isoformat() if newest_dt else None
        result.append({"name": name, "count": count, "oldest": oldest, "newest": newest})
    return result


async def purge_old_data(db: AsyncSession, target: str, older_than_days: int) -> int:
    """Delete records older than N days for the specified target."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    model_map = {
        "conversations": (Conversation, Conversation.created_at),
        "messages": (Message, Message.created_at),
        "todos": (Todo, Todo.completed_at),
    }
    if target not in model_map:
        return 0

    model, date_col = model_map[target]

    if target == "todos":
        q = select(model).where(
            Todo.status == TaskStatus.COMPLETED,
            date_col.isnot(None),
            date_col < cutoff,
        )
    else:
        q = select(model).where(date_col < cutoff)

    rows = (await db.execute(q)).scalars().all()
    count = len(rows)
    dependent_source_ids: set[str] = set()
    if target == "todos":
        dependent_source_ids = await task_relationship_service.dependent_source_ids(
            db,
            {row.id for row in rows},
        )
    for row in rows:
        await db.delete(row)
    await db.flush()
    await task_relationship_service.sync_dependency_shadows(
        db,
        dependent_source_ids,
    )
    await db.commit()
    return count


async def reindex_fts(db: AsyncSession) -> list[str]:
    """Drop and rebuild FTS5 content."""
    return await rebuild_fts(db)


async def backup_database() -> tuple[str, int]:
    """Copy SQLite DB to a timestamped backup file."""
    db_path = settings.database_url.split("///")[-1]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"clawchat_backup_{timestamp}.db"
    backup_dir = os.path.join(os.path.dirname(db_path), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, backup_filename)
    await asyncio.to_thread(_copy_sqlite_database, db_path, backup_path)
    size = os.path.getsize(backup_path)
    return backup_filename, size


def _copy_sqlite_database(source_path: str, backup_path: str) -> None:
    """Snapshot a live database with SQLite's online backup API.

    Under WAL the recent commits live in ``-wal`` until a checkpoint, so a
    plain file copy can miss them or catch a page mid-write. The backup API
    copies one consistent read snapshot without blocking writers. The copy is
    switched back to a rollback journal so it is a single self-contained file,
    and only renamed into place once complete.
    """
    partial_path = f"{backup_path}.partial"
    source = sqlite3.connect(source_path, timeout=30)
    try:
        destination = sqlite3.connect(partial_path)
        try:
            source.backup(destination)
            destination.execute("PRAGMA journal_mode=DELETE")
        finally:
            destination.close()
    except BaseException:
        if os.path.exists(partial_path):
            os.remove(partial_path)
        raise
    finally:
        source.close()
    os.replace(partial_path, backup_path)
