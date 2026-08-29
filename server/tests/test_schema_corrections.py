"""Startup-path coverage for the pre-Alembic schema adoption and reconcilers.

Alembic owns the schema. What is exercised here is the part of startup Alembic
cannot own: the frozen correction list that lifts a pre-Alembic database onto
the baseline revision so it can be stamped, the FTS5 objects that ORM metadata
cannot express, and the dependency reconciliation that must run on every boot.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from database import (
    Base,
    _apply_legacy_baseline_corrections,
    _run_data_migrations,
    _setup_fts,
)
from domain.task_relationship import TASK_RELATIONSHIP_MIGRATION_MARKER
from exceptions import ValidationError
from models.data_migration_marker import DataMigrationMarker
from models.task_relationship import TaskRelationship


# Use a dedicated in-memory engine for schema correction tests so we can
# control table creation independently of the conftest fixtures.
_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
_session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)

_NOW = datetime.now(timezone.utc).isoformat()


async def _apply_corrections(session: AsyncSession) -> None:
    """Run the legacy baseline corrections against an async session."""
    connection = await session.connection()
    await connection.run_sync(_apply_legacy_baseline_corrections)
    await session.commit()


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
    """The legacy corrections must survive a second startup unchanged."""
    await _apply_corrections(fresh_db)
    await _apply_corrections(fresh_db)


@pytest.mark.asyncio
async def test_fts_setup_idempotent(fresh_db: AsyncSession):
    """Running _setup_fts twice must not raise."""
    await _setup_fts(fresh_db)
    await _setup_fts(fresh_db)


# ---- Schema correction tests ----


# The shape a ClawChat database had before any of the baseline columns were
# introduced. The corrections must lift exactly this onto the baseline schema,
# because that is what makes it stampable.
_PRE_BASELINE_TABLES = (
    """
    CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        due_date DATETIME,
        completed_at DATETIME,
        conversation_id TEXT,
        message_id TEXT,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        tags TEXT
    )
    """,
    """
    CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        is_archived BOOLEAN NOT NULL,
        metadata TEXT
    )
    """,
    """
    CREATE TABLE agent_tasks (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        parent_task_id TEXT,
        agent_type TEXT NOT NULL,
        progress INTEGER NOT NULL,
        progress_message TEXT,
        sub_task_count INTEGER NOT NULL,
        completed_sub_tasks INTEGER NOT NULL,
        conversation_id TEXT,
        message_id TEXT,
        created_at DATETIME NOT NULL,
        started_at DATETIME,
        completed_at DATETIME
    )
    """,
    """
    CREATE TABLE paired_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_token TEXT NOT NULL UNIQUE,
        paired_at DATETIME NOT NULL,
        last_seen DATETIME NOT NULL,
        is_active BOOLEAN NOT NULL,
        push_token TEXT
    )
    """,
)

_BASELINE_COLUMNS = {
    "todos": (
        "parent_id", "sort_order", "source", "source_id", "assignee",
        "inbox_state", "estimated_minutes", "automation_error",
        "enabled_skills", "clarification_questions", "clarification_answers",
        "depends_on", "recurrence_rule", "recurrence_end",
        "recurrence_exceptions", "recurring_source_id",
    ),
    "conversations": ("project_todo_id",),
    "agent_tasks": (
        "todo_id", "payload_json", "skill_chain", "current_skill_index",
    ),
    "paired_devices": ("public_key",),
}


@pytest.mark.asyncio
async def test_corrections_add_missing_columns(tmp_path):
    """A pre-baseline schema gains every column the baseline revision expects.

    This is what makes ``_detect_legacy_revision`` able to stamp such a
    database: without these columns the baseline probe would be lying, and the
    revisions that follow reference the columns in their triggers.
    """
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{(tmp_path / 'pre-baseline.db').as_posix()}"
    )
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            for statement in _PRE_BASELINE_TABLES:
                await connection.execute(text(statement))

        async with factory() as session:
            await _apply_corrections(session)

            for table, expected in _BASELINE_COLUMNS.items():
                rows = await session.execute(text(f"PRAGMA table_info({table})"))
                present = {row[1] for row in rows.fetchall()}
                missing = sorted(set(expected) - present)
                assert not missing, f"Missing columns on {table}: {missing}"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_corrections_leave_post_baseline_columns_to_alembic(
    fresh_db: AsyncSession,
):
    """The frozen list must not shadow a column an Alembic revision owns.

    ``todos.project_id``, ``messages.idempotency_key`` and the Paseo execution
    columns are added by revisions. If a correction added them too, a legacy
    database would be stamped below those revisions and then fail the upgrade
    with a duplicate column.
    """
    from database import _LEGACY_BASELINE_CORRECTIONS

    revision_owned = (
        "project_id",
        "idempotency_key",
        "execution_workspace_isolation",
        "external_run_id",
        "default_execution_model",
        "execution_workspace_path",
        "execution_base_branch",
    )
    offenders = [
        statement
        for statement in _LEGACY_BASELINE_CORRECTIONS
        if statement.startswith("ALTER TABLE")
        and any(f" ADD COLUMN {column} " in statement for column in revision_owned)
    ]
    assert not offenders, offenders


# ---- Data migration tests ----


# ``test_skill_migration`` / ``test_skill_migration_idempotent`` moved to
# tests/test_legacy_startup_migration.py: the assignee -> enabled_skills
# transform is now Alembic revision f0d5c8a12b64, so it is covered against a
# real migration run instead of against ``_run_data_migrations``.


@pytest.mark.asyncio
async def test_legacy_dependency_backfill_is_idempotent(fresh_db: AsyncSession):
    prerequisite_id, prerequisite_stmt, prerequisite_params = _todo_insert()
    await fresh_db.execute(prerequisite_stmt, prerequisite_params)
    dependent_id, dependent_stmt, dependent_params = _todo_insert(
        extra_cols=", depends_on",
        extra_vals=", :depends_on",
        extra_params={"depends_on": f'[\"{prerequisite_id}\"]'},
    )
    await fresh_db.execute(dependent_stmt, dependent_params)
    await fresh_db.commit()

    await _run_data_migrations(fresh_db)
    await _run_data_migrations(fresh_db)

    relationships = list(
        (
            await fresh_db.execute(
                select(TaskRelationship).where(
                    TaskRelationship.source_task_id == dependent_id
                )
            )
        ).scalars().all()
    )
    assert len(relationships) == 1
    assert relationships[0].target_task_id == prerequisite_id
    assert relationships[0].type == "depends_on"
    assert relationships[0].created_by == "legacy"
    count = (
        await fresh_db.execute(select(func.count(TaskRelationship.id)))
    ).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_legacy_dependency_backfill_rejects_dangling_edges(
    fresh_db: AsyncSession,
):
    _todo_id, statement, params = _todo_insert(
        extra_cols=", depends_on",
        extra_vals=", '[\"todo_missing\"]'",
    )
    await fresh_db.execute(statement, params)
    await fresh_db.commit()

    with pytest.raises(ValidationError, match="missing dependency"):
        await _run_data_migrations(fresh_db)
    await fresh_db.rollback()
    assert (
        await fresh_db.get(
            DataMigrationMarker,
            TASK_RELATIONSHIP_MIGRATION_MARKER,
        )
        is None
    )


@pytest.mark.asyncio
async def test_repeated_startup_does_not_resurrect_deleted_dependency(
    fresh_db: AsyncSession,
):
    prerequisite_id, prerequisite_stmt, prerequisite_params = _todo_insert()
    await fresh_db.execute(prerequisite_stmt, prerequisite_params)
    dependent_id, dependent_stmt, dependent_params = _todo_insert(
        extra_cols=", depends_on",
        extra_vals=", :depends_on",
        extra_params={"depends_on": f'[\"{prerequisite_id}\"]'},
    )
    await fresh_db.execute(dependent_stmt, dependent_params)
    await fresh_db.commit()

    await _run_data_migrations(fresh_db)
    await fresh_db.execute(
        delete(TaskRelationship).where(
            TaskRelationship.source_task_id == dependent_id
        )
    )
    await fresh_db.commit()

    # The retained JSON is now stale. On subsequent startups the existing
    # normalized table is authoritative and must clear it, not re-import it.
    stale_shadow = await fresh_db.execute(
        text("SELECT depends_on FROM todos WHERE id = :id"),
        {"id": dependent_id},
    )
    assert stale_shadow.scalar_one() == f'[\"{prerequisite_id}\"]'

    await _run_data_migrations(fresh_db)

    relationship_count = (
        await fresh_db.execute(select(func.count(TaskRelationship.id)))
    ).scalar_one()
    assert relationship_count == 0
    reconciled_shadow = await fresh_db.execute(
        text("SELECT depends_on FROM todos WHERE id = :id"),
        {"id": dependent_id},
    )
    assert reconciled_shadow.scalar_one() is None


# ---- FTS tests ----


@pytest.mark.asyncio
async def test_fts_trigger_sync(fresh_db: AsyncSession):
    """Inserting a todo should automatically populate todos_fts via trigger."""
    await _setup_fts(fresh_db)

    tid = str(uuid.uuid4())
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
