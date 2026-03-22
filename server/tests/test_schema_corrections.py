"""Verify that schema corrections bring old schemas up to date."""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from database import (
    Base,
    _apply_schema_corrections,
    _run_data_migrations,
    _setup_fts,
)


# Use a dedicated in-memory engine for schema correction tests so we can
# control table creation independently of the conftest fixtures.
_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
_session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)

_NOW = datetime.now(timezone.utc).isoformat()


def _todo_insert(extra_cols: str = "", extra_vals: str = "", extra_params: dict | None = None):
    """Build a parameterised INSERT for the todos table with all NOT NULL columns."""
    tid = str(uuid.uuid4())
    cols = f"id, title, status, priority, sort_order, inbox_state, created_at, updated_at{extra_cols}"
    vals = f":id, :title, 'pending', 'medium', 0, 'none', :now, :now{extra_vals}"
    params = {"id": tid, "title": f"todo-{tid[:8]}", "now": _NOW}
    if extra_params:
        params.update(extra_params)
    return tid, text(f"INSERT INTO todos ({cols}) VALUES ({vals})"), params


@pytest_asyncio.fixture
async def fresh_db():
    """Create all tables from ORM models, yield a session, then tear down."""
    from models import _register_all  # noqa: F401

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with _session_factory() as session:
        yield session
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        # Drop FTS virtual tables that aren't tracked by ORM metadata
        for tbl in ("messages_fts", "todos_fts", "events_fts"):
            await conn.execute(text(f"DROP TABLE IF EXISTS {tbl}"))


# ---- Idempotency tests ----


@pytest.mark.asyncio
async def test_corrections_idempotent(fresh_db: AsyncSession):
    """Running _apply_schema_corrections twice must not raise."""
    await _apply_schema_corrections(fresh_db)
    await _apply_schema_corrections(fresh_db)


@pytest.mark.asyncio
async def test_fts_setup_idempotent(fresh_db: AsyncSession):
    """Running _setup_fts twice must not raise."""
    await _setup_fts(fresh_db)
    await _setup_fts(fresh_db)


# ---- Schema correction tests ----


@pytest.mark.asyncio
async def test_corrections_add_missing_columns(fresh_db: AsyncSession):
    """After corrections, expected columns exist on their tables."""
    await _apply_schema_corrections(fresh_db)

    # Check todos columns
    rows = await fresh_db.execute(text("PRAGMA table_info(todos)"))
    todo_cols = {r[1] for r in rows.fetchall()}
    for col in (
        "parent_id", "sort_order", "source", "source_id",
        "assignee", "inbox_state", "estimated_minutes",
        "automation_error", "enabled_skills",
    ):
        assert col in todo_cols, f"Missing column todos.{col}"

    # Check conversations columns
    rows = await fresh_db.execute(text("PRAGMA table_info(conversations)"))
    conv_cols = {r[1] for r in rows.fetchall()}
    assert "project_todo_id" in conv_cols

    # Check agent_tasks columns
    rows = await fresh_db.execute(text("PRAGMA table_info(agent_tasks)"))
    task_cols = {r[1] for r in rows.fetchall()}
    for col in ("todo_id", "payload_json", "skill_chain", "current_skill_index"):
        assert col in task_cols, f"Missing column agent_tasks.{col}"


# ---- Data migration tests ----


@pytest.mark.asyncio
async def test_skill_migration(fresh_db: AsyncSession):
    """Legacy assignee values are converted to enabled_skills."""
    await _apply_schema_corrections(fresh_db)

    # Insert test todos with legacy assignee values and no enabled_skills
    for assignee in ("planner", "researcher", "executor"):
        tid, stmt, params = _todo_insert(
            extra_cols=", assignee",
            extra_vals=", :assignee",
            extra_params={"assignee": assignee},
        )
        params["title"] = f"task-{assignee}"
        await fresh_db.execute(stmt, params)
    await fresh_db.commit()

    await _run_data_migrations(fresh_db)

    rows = await fresh_db.execute(
        text("SELECT assignee, enabled_skills FROM todos ORDER BY title")
    )
    results = {r[0]: r[1] for r in rows.fetchall()}
    assert results["executor"] == '[\"obsidian_sync\"]'
    assert results["planner"] == '[\"plan\"]'
    assert results["researcher"] == '[\"research\"]'


@pytest.mark.asyncio
async def test_skill_migration_idempotent(fresh_db: AsyncSession):
    """Running skill migration twice doesn't overwrite existing enabled_skills."""
    await _apply_schema_corrections(fresh_db)

    tid, stmt, params = _todo_insert(
        extra_cols=", assignee, enabled_skills",
        extra_vals=", 'planner', '[\"custom\"]'",
    )
    params["title"] = "already set"
    await fresh_db.execute(stmt, params)
    await fresh_db.commit()

    await _run_data_migrations(fresh_db)

    row = await fresh_db.execute(
        text("SELECT enabled_skills FROM todos WHERE id = :id"),
        {"id": tid},
    )
    assert row.scalar() == '[\"custom\"]', "Should not overwrite existing enabled_skills"


# ---- FTS tests ----


@pytest.mark.asyncio
async def test_fts_trigger_sync(fresh_db: AsyncSession):
    """Inserting a todo should automatically populate todos_fts via trigger."""
    await _apply_schema_corrections(fresh_db)
    await _setup_fts(fresh_db)

    tid, stmt, params = _todo_insert()
    params["title"] = "Buy groceries"
    # Also set description via raw SQL
    cols_with_desc = stmt.text.replace("updated_at", "updated_at, description")
    vals_with_desc = cols_with_desc.split("VALUES")[1] if "VALUES" in cols_with_desc else ""
    # Easier: just build a new statement
    await fresh_db.execute(
        text(
            "INSERT INTO todos (id, title, description, status, priority, sort_order, inbox_state, created_at, updated_at) "
            "VALUES (:id, 'Buy groceries', 'Milk and eggs', 'pending', 'medium', 0, 'none', :now, :now)"
        ),
        {"id": tid, "now": _NOW},
    )
    await fresh_db.commit()

    row = await fresh_db.execute(
        text("SELECT id, title, description FROM todos_fts WHERE id = :id"),
        {"id": tid},
    )
    fts_row = row.fetchone()
    assert fts_row is not None, "FTS trigger should have inserted a row"
    assert fts_row[1] == "Buy groceries"
    assert fts_row[2] == "Milk and eggs"


@pytest.mark.asyncio
async def test_fts_backfill(fresh_db: AsyncSession):
    """Existing todos inserted before FTS setup get backfilled."""
    await _apply_schema_corrections(fresh_db)

    # Insert a todo BEFORE FTS tables exist
    tid = str(uuid.uuid4())
    await fresh_db.execute(
        text(
            "INSERT INTO todos (id, title, description, status, priority, sort_order, inbox_state, created_at, updated_at) "
            "VALUES (:id, 'Pre-existing task', 'Was here before FTS', 'pending', 'medium', 0, 'none', :now, :now)"
        ),
        {"id": tid, "now": _NOW},
    )
    await fresh_db.commit()

    # Now run FTS setup (creates tables, triggers, AND backfills)
    await _setup_fts(fresh_db)

    row = await fresh_db.execute(
        text("SELECT id, title FROM todos_fts WHERE id = :id"),
        {"id": tid},
    )
    fts_row = row.fetchone()
    assert fts_row is not None, "Backfill should have populated FTS for pre-existing todo"
    assert fts_row[1] == "Pre-existing task"
