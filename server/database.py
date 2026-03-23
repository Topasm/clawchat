import os

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ---------------------------------------------------------------------------
# FTS5 setup: individual DDL statements (triggers contain nested semicolons
# so we store them as a list rather than splitting on ";")
# ---------------------------------------------------------------------------

_FTS5_VIRTUAL_TABLES = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(id UNINDEXED, content)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS todos_fts USING fts5(id UNINDEXED, title, description)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(id UNINDEXED, title, description, location)",
]

_FTS5_TRIGGERS = [
    # -- Messages triggers
    """CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(id, content) VALUES (new.id, new.content);
    END""",
    """CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        DELETE FROM messages_fts WHERE id = old.id;
        INSERT INTO messages_fts(id, content) VALUES (new.id, new.content);
    END""",
    """CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE id = old.id;
    END""",
    # -- Todos triggers
    """CREATE TRIGGER IF NOT EXISTS todos_ai AFTER INSERT ON todos BEGIN
        INSERT INTO todos_fts(id, title, description)
        VALUES (new.id, new.title, COALESCE(new.description, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS todos_au AFTER UPDATE ON todos BEGIN
        DELETE FROM todos_fts WHERE id = old.id;
        INSERT INTO todos_fts(id, title, description)
        VALUES (new.id, new.title, COALESCE(new.description, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS todos_ad AFTER DELETE ON todos BEGIN
        DELETE FROM todos_fts WHERE id = old.id;
    END""",
    # -- Events triggers
    """CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(id, title, description, location)
        VALUES (new.id, new.title, COALESCE(new.description, ''), COALESCE(new.location, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
        INSERT INTO events_fts(id, title, description, location)
        VALUES (new.id, new.title, COALESCE(new.description, ''), COALESCE(new.location, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
    END""",
]

_FTS5_BACKFILL = [
    """INSERT INTO messages_fts(id, content)
        SELECT id, content FROM messages
        WHERE id NOT IN (SELECT id FROM messages_fts)""",
    """INSERT INTO todos_fts(id, title, description)
        SELECT id, title, COALESCE(description, '') FROM todos
        WHERE id NOT IN (SELECT id FROM todos_fts)""",
    """INSERT INTO events_fts(id, title, description, location)
        SELECT id, title, COALESCE(description, ''), COALESCE(location, '') FROM events
        WHERE id NOT IN (SELECT id FROM events_fts)""",
]


# ---------------------------------------------------------------------------
# Database initialization helpers
# ---------------------------------------------------------------------------

def _ensure_data_dir():
    """Create the data and upload directories if they don't exist."""
    db_path = settings.database_url.split("///")[-1]
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    from config import settings as app_settings
    os.makedirs(app_settings.upload_dir, exist_ok=True)


async def _apply_schema_corrections(session: AsyncSession):
    """Add columns that may be missing from older schemas.

    Each statement is idempotent -- duplicate column errors are silently ignored.
    Grouped by table for readability.
    """
    corrections = [
        # -- todos --
        "ALTER TABLE todos ADD COLUMN parent_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
        "ALTER TABLE todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE todos ADD COLUMN source TEXT",
        "ALTER TABLE todos ADD COLUMN source_id TEXT",
        "ALTER TABLE todos ADD COLUMN assignee TEXT",
        "ALTER TABLE todos ADD COLUMN inbox_state TEXT NOT NULL DEFAULT 'none'",
        "ALTER TABLE todos ADD COLUMN estimated_minutes INTEGER",
        "ALTER TABLE todos ADD COLUMN automation_error TEXT",
        "ALTER TABLE todos ADD COLUMN enabled_skills TEXT",
        "ALTER TABLE todos ADD COLUMN recurrence_rule TEXT",
        "ALTER TABLE todos ADD COLUMN recurrence_end DATETIME",
        "ALTER TABLE todos ADD COLUMN recurrence_exceptions TEXT",
        "ALTER TABLE todos ADD COLUMN recurring_source_id TEXT REFERENCES todos(id) ON DELETE SET NULL",

        # -- conversations --
        "ALTER TABLE conversations ADD COLUMN project_todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL",

        # -- agent_tasks --
        "ALTER TABLE agent_tasks ADD COLUMN todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
        "ALTER TABLE agent_tasks ADD COLUMN payload_json TEXT",
        "ALTER TABLE agent_tasks ADD COLUMN skill_chain TEXT",
        "ALTER TABLE agent_tasks ADD COLUMN current_skill_index INTEGER NOT NULL DEFAULT 0",
    ]

    for stmt in corrections:
        try:
            await session.execute(text(stmt))
        except (OperationalError, Exception):
            pass  # column already exists
    await session.commit()


async def _run_data_migrations(session: AsyncSession):
    """One-time data transforms. Each is idempotent (WHERE ... IS NULL guards)."""
    migrations = [
        "UPDATE todos SET enabled_skills = '[\"plan\"]' WHERE assignee = 'planner' AND enabled_skills IS NULL",
        "UPDATE todos SET enabled_skills = '[\"research\"]' WHERE assignee = 'researcher' AND enabled_skills IS NULL",
        "UPDATE todos SET enabled_skills = '[\"obsidian_sync\"]' WHERE assignee = 'executor' AND enabled_skills IS NULL",
    ]

    for stmt in migrations:
        try:
            await session.execute(text(stmt))
        except OperationalError:
            pass
    await session.commit()


async def _setup_fts(session: AsyncSession):
    """Create FTS5 virtual tables, sync triggers, and backfill missing rows."""
    for stmt in _FTS5_VIRTUAL_TABLES:
        await session.execute(text(stmt))
    for stmt in _FTS5_TRIGGERS:
        await session.execute(text(stmt))
    for stmt in _FTS5_BACKFILL:
        await session.execute(text(stmt))
    await session.commit()


async def init_db():
    """Initialize database: create tables, apply corrections, setup FTS."""
    _ensure_data_dir()

    async with engine.begin() as conn:
        from models import _register_all  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSession(engine) as session:
        await _apply_schema_corrections(session)
        await _run_data_migrations(session)
        await _setup_fts(session)


async def get_db():
    async with async_session_factory() as session:
        yield session
