import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping

from alembic import command
from alembic.config import Config
from sqlalchemy import event, inspect, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DatabaseError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings
from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID, PlanProposalStatus
from domain.task import TaskStatus
from domain.task_relationship import TASK_RELATIONSHIP_MIGRATION_MARKER

logger = logging.getLogger(__name__)


_SQLITE_CONNECTION_PRAGMAS = (
    # Make SQLite enforce the same FK cascades as production databases.
    "PRAGMA foreign_keys=ON",
    # Readers no longer block the writer, and a commit appends to the WAL
    # instead of rewriting the rollback journal. The file grows -wal and -shm
    # siblings, so copy the database with the backup API, never file by file.
    "PRAGMA journal_mode=WAL",
    # Under WAL, NORMAL only fsyncs at checkpoints: a power cut can lose the
    # last commits but never corrupts the file.
    "PRAGMA synchronous=NORMAL",
    # The scheduler, the request handlers and the workers share one file;
    # wait for a competing writer instead of failing with "database is locked".
    "PRAGMA busy_timeout=5000",
    "PRAGMA temp_store=MEMORY",
)


@event.listens_for(Engine, "connect")
def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
    """Apply the per-connection SQLite settings every engine relies on."""
    if "sqlite" not in type(dbapi_connection).__module__:
        return
    cursor = dbapi_connection.cursor()
    try:
        for pragma in _SQLITE_CONNECTION_PRAGMAS:
            cursor.execute(pragma)
    finally:
        cursor.close()


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ---------------------------------------------------------------------------
# FTS5 setup: individual DDL statements (triggers contain nested semicolons
# so we store them as a list rather than splitting on ";")
#
# Each FTS row shares the rowid of the row it indexes, so the sync triggers
# find it through the rowid B-tree instead of scanning the UNINDEXED ``id``
# column. ``id`` stays in the index so search can still join on the primary
# key. Source rowids are not aliased by an INTEGER PRIMARY KEY and a dump or a
# VACUUM may renumber them, so ``_setup_fts`` checks the pairing at startup and
# rebuilds any index that drifted.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _FtsIndex:
    source: str
    columns: tuple[str, ...]
    #: Source expressions in ``columns`` order for the given row alias.
    values: Callable[[str], str]

    @property
    def table(self) -> str:
        return f"{self.source}_fts"


_FTS_INDEXES = (
    _FtsIndex(
        source="messages",
        columns=("content",),
        values=lambda row: f"{row}.content",
    ),
    _FtsIndex(
        source="todos",
        columns=("title", "description"),
        values=lambda row: f"{row}.title, COALESCE({row}.description, '')",
    ),
    _FtsIndex(
        source="events",
        columns=("title", "description", "location"),
        values=lambda row: (
            f"{row}.title, COALESCE({row}.description, ''), "
            f"COALESCE({row}.location, '')"
        ),
    ),
)

# Trigger names the id-keyed FTS sync used before revision 5e0a7c3d9b14.
_LEGACY_FTS5_TRIGGERS = tuple(
    f"{index.source}_{suffix}"
    for index in _FTS_INDEXES
    for suffix in ("ai", "au", "ad")
)


def _fts_insert_sql(index: _FtsIndex, row: str) -> str:
    columns = ", ".join(index.columns)
    return (
        f"INSERT INTO {index.table}(rowid, id, {columns}) "
        f"VALUES ({row}.rowid, {row}.id, {index.values(row)});"
    )


def _fts_triggers(index: _FtsIndex) -> list[str]:
    columns = ", ".join(index.columns)
    return [
        # Clear the rowid first: SQLite hands a deleted maximum rowid to the
        # next insert, and a leftover entry would make the insert fail.
        f"""CREATE TRIGGER IF NOT EXISTS {index.table}_ai
        AFTER INSERT ON {index.source} BEGIN
            DELETE FROM {index.table} WHERE rowid = new.rowid;
            {_fts_insert_sql(index, "new")}
        END""",
        f"""CREATE TRIGGER IF NOT EXISTS {index.table}_au
        AFTER UPDATE OF {columns} ON {index.source} BEGIN
            DELETE FROM {index.table} WHERE rowid = old.rowid;
            {_fts_insert_sql(index, "new")}
        END""",
        f"""CREATE TRIGGER IF NOT EXISTS {index.table}_ad
        AFTER DELETE ON {index.source} BEGIN
            DELETE FROM {index.table} WHERE rowid = old.rowid;
        END""",
    ]


def _fts_virtual_table_sql(index: _FtsIndex) -> str:
    columns = ", ".join(index.columns)
    return (
        f"CREATE VIRTUAL TABLE IF NOT EXISTS {index.table} "
        f"USING fts5(id UNINDEXED, {columns})"
    )


def _fts_drift_sql(index: _FtsIndex) -> str:
    """True when the index is not exactly one entry per source row."""
    return f"""
        SELECT
            (SELECT count(*) FROM {index.table})
                != (SELECT count(*) FROM {index.source})
            OR EXISTS (
                SELECT 1 FROM {index.table} AS f
                LEFT JOIN {index.source} AS s ON s.rowid = f.rowid
                WHERE s.id IS NULL OR s.id != f.id
            )
    """


def _fts_rebuild_sql(index: _FtsIndex) -> list[str]:
    columns = ", ".join(index.columns)
    return [
        f"DELETE FROM {index.table}",
        f"""INSERT INTO {index.table}(rowid, id, {columns})
            SELECT s.rowid, s.id, {index.values("s")} FROM {index.source} AS s""",
    ]


_TASK_RELATIONSHIP_CYCLE_TRIGGERS = [
    """
    CREATE TRIGGER IF NOT EXISTS task_relationships_prevent_dependency_cycle_insert
    BEFORE INSERT ON task_relationships
    WHEN NEW.type = 'depends_on'
    BEGIN
        WITH RECURSIVE reachable(task_id) AS (
            SELECT NEW.target_task_id
            UNION
            SELECT relationship.target_task_id
            FROM task_relationships AS relationship
            JOIN reachable
              ON relationship.source_task_id = reachable.task_id
            WHERE relationship.type = 'depends_on'
        )
        SELECT RAISE(ABORT, 'dependency cycle detected')
        WHERE EXISTS (
            SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS task_relationships_prevent_dependency_cycle_update
    BEFORE UPDATE OF source_task_id, target_task_id, type ON task_relationships
    WHEN NEW.type = 'depends_on'
    BEGIN
        WITH RECURSIVE reachable(task_id) AS (
            SELECT NEW.target_task_id
            UNION
            SELECT relationship.target_task_id
            FROM task_relationships AS relationship
            JOIN reachable
              ON relationship.source_task_id = reachable.task_id
            WHERE relationship.type = 'depends_on'
              AND relationship.id <> OLD.id
        )
        SELECT RAISE(ABORT, 'dependency cycle detected')
        WHERE EXISTS (
            SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
        );
    END
    """,
]

_TASK_GRAPH_TODO_SEMANTIC_COLUMNS = (
    "project_id",
    "title",
    "description",
    "status",
    "priority",
    "due_date",
    "completed_at",
    "conversation_id",
    "message_id",
    "tags",
    "parent_id",
    "sort_order",
    "source",
    "source_id",
    "assignee",
    "enabled_skills",
    "estimated_minutes",
    "clarification_questions",
    "clarification_answers",
    "recurrence_rule",
    "recurrence_end",
    "recurrence_exceptions",
    "recurring_source_id",
)
_TASK_GRAPH_TODO_UPDATE_COLUMNS_SQL = ", ".join(
    _TASK_GRAPH_TODO_SEMANTIC_COLUMNS
)
_TASK_GRAPH_TODO_UPDATE_CHANGED_SQL = " OR ".join(
    f"OLD.{column} IS NOT NEW.{column}"
    for column in _TASK_GRAPH_TODO_SEMANTIC_COLUMNS
)
_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL = f"""
    UPDATE task_graph_states
    SET revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE scope_id = '{GLOBAL_TASK_GRAPH_SCOPE_ID}';
"""


def _project_revision_update_sql(project_expression: str) -> str:
    return f"""
        UPDATE projects
        SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = {project_expression};
    """


def _relationship_project_revision_update_sql(prefix: str) -> str:
    return f"""
        UPDATE projects
        SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT project_id FROM todos
            WHERE id IN ({prefix}.source_task_id, {prefix}.target_task_id)
              AND project_id IS NOT NULL
        );
    """

_TASK_GRAPH_REVISION_TRIGGERS: list[tuple[str, str]] = [
    (
        "todos",
        f"""
        CREATE TRIGGER IF NOT EXISTS todos_bump_task_graph_revision_insert
        AFTER INSERT ON todos
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_project_revision_update_sql("NEW.project_id")}
        END
        """,
    ),
    (
        "todos",
        f"""
        CREATE TRIGGER IF NOT EXISTS todos_bump_task_graph_revision_delete
        AFTER DELETE ON todos
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_project_revision_update_sql("OLD.project_id")}
        END
        """,
    ),
    (
        "todos",
        f"""
        CREATE TRIGGER IF NOT EXISTS todos_bump_task_graph_revision_update
        AFTER UPDATE OF {_TASK_GRAPH_TODO_UPDATE_COLUMNS_SQL} ON todos
        WHEN {_TASK_GRAPH_TODO_UPDATE_CHANGED_SQL}
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            UPDATE projects
            SET graph_revision = graph_revision + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (OLD.project_id, NEW.project_id);
        END
        """,
    ),
    (
        "task_relationships",
        f"""
        CREATE TRIGGER IF NOT EXISTS task_relationships_bump_graph_revision_insert
        AFTER INSERT ON task_relationships
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_relationship_project_revision_update_sql("NEW")}
        END
        """,
    ),
    (
        "task_relationships",
        f"""
        CREATE TRIGGER IF NOT EXISTS task_relationships_bump_graph_revision_update
        AFTER UPDATE ON task_relationships
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            UPDATE projects
            SET graph_revision = graph_revision + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (
                SELECT project_id FROM todos
                WHERE id IN (
                    OLD.source_task_id, OLD.target_task_id,
                    NEW.source_task_id, NEW.target_task_id
                )
                  AND project_id IS NOT NULL
            );
        END
        """,
    ),
    (
        "task_relationships",
        f"""
        CREATE TRIGGER IF NOT EXISTS task_relationships_bump_graph_revision_delete
        AFTER DELETE ON task_relationships
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_relationship_project_revision_update_sql("OLD")}
        END
        """,
    ),
]


def _install_task_graph_state_sync(connection) -> None:
    """Seed the global graph state and install SQLite revision triggers."""
    inspector = inspect(connection)
    if not inspector.has_table("task_graph_states"):
        return

    seed_params = {"scope_id": GLOBAL_TASK_GRAPH_SCOPE_ID}
    if connection.dialect.name == "sqlite":
        connection.execute(
            text(
                "INSERT OR IGNORE INTO task_graph_states "
                "(scope_id, revision, updated_at) "
                "VALUES (:scope_id, 0, CURRENT_TIMESTAMP)"
            ),
            seed_params,
        )
    elif connection.dialect.name == "postgresql":
        connection.execute(
            text(
                "INSERT INTO task_graph_states "
                "(scope_id, revision, updated_at) "
                "VALUES (:scope_id, 0, CURRENT_TIMESTAMP) "
                "ON CONFLICT (scope_id) DO NOTHING"
            ),
            seed_params,
        )
    else:
        exists = connection.execute(
            text(
                "SELECT 1 FROM task_graph_states "
                "WHERE scope_id = :scope_id"
            ),
            seed_params,
        ).scalar_one_or_none()
        if exists is None:
            connection.execute(
                text(
                    "INSERT INTO task_graph_states "
                    "(scope_id, revision, updated_at) "
                    "VALUES (:scope_id, 0, CURRENT_TIMESTAMP)"
                ),
                seed_params,
            )

    if connection.dialect.name != "sqlite":
        return

    # This also fires from ``Base.metadata.create_all`` in the test fixtures,
    # and from ``_setup_task_graph_revision`` on a database that is only part
    # way up the revision chain.  A trigger that refers to a missing
    # ``OLD.<column>``/``NEW.<column>`` makes SQLite reject startup, so defer
    # all Todo triggers until the complete semantic column set is present.
    # ``_setup_task_graph_revision`` retries after the migrations have run.
    todo_columns: set[str] = set()
    if inspector.has_table("todos"):
        todo_columns = {
            column["name"] for column in inspector.get_columns("todos")
        }
    todo_triggers_are_safe = (
        inspector.has_table("projects")
        and set(_TASK_GRAPH_TODO_SEMANTIC_COLUMNS).issubset(todo_columns)
    )
    for target_table, statement in _TASK_GRAPH_REVISION_TRIGGERS:
        if not inspector.has_table(target_table):
            continue
        if not todo_triggers_are_safe:
            continue
        connection.execute(text(statement))


@event.listens_for(Base.metadata, "after_create")
def _install_task_graph_state_after_create(
    _metadata,
    connection,
    **_kwargs,
) -> None:
    """Keep direct ``Base.metadata.create_all`` test/bootstrap paths safe."""
    _install_task_graph_state_sync(connection)


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


# ---------------------------------------------------------------------------
# Alembic is the single source of truth for the schema.
#
# ``init_db`` runs ``alembic upgrade head`` on every startup.  Databases that
# predate the Alembic adoption were built by ``Base.metadata.create_all`` plus
# the hand-written corrections below and therefore carry no ``alembic_version``
# row.  Those are recognised by their schema shape, stamped at the matching
# revision, and then upgraded like everything else.  After that first startup a
# legacy database is indistinguishable from a fresh one.
# ---------------------------------------------------------------------------

def _migrations_dir() -> Path:
    """Locate ``migrations/`` in both a source checkout and a frozen build.

    PyInstaller unpacks bundled data next to the executable rather than beside
    this module, so the packaged desktop sidecar has to look at ``_MEIPASS``.
    """
    frozen_root = getattr(sys, "_MEIPASS", None)
    base = Path(frozen_root) if frozen_root else Path(__file__).resolve().parent
    return base / "migrations"


_MIGRATIONS_DIR = _migrations_dir()

# Column additions that predate the Alembic baseline revision. They exist only
# to lift a pre-Alembic database onto the baseline schema so it can be stamped;
# every column added after the baseline belongs to a revision instead. This list
# is frozen -- do not extend it. New columns go into a new Alembic revision.
_LEGACY_BASELINE_CORRECTIONS = (
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
    "ALTER TABLE todos ADD COLUMN clarification_questions TEXT",
    "ALTER TABLE todos ADD COLUMN clarification_answers TEXT",
    "ALTER TABLE todos ADD COLUMN depends_on TEXT",
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
    # -- paired_devices --
    "ALTER TABLE paired_devices ADD COLUMN public_key TEXT",
    # -- baseline indexes over the columns above --
    "CREATE INDEX IF NOT EXISTS idx_todos_parent_id ON todos(parent_id)",
    "CREATE INDEX IF NOT EXISTS idx_todos_sort_order ON todos(sort_order)",
    "CREATE INDEX IF NOT EXISTS idx_todos_source ON todos(source)",
    "CREATE INDEX IF NOT EXISTS idx_todos_recurrence_rule ON todos(recurrence_rule)",
    "CREATE INDEX IF NOT EXISTS idx_conversations_project_todo_id "
    "ON conversations(project_todo_id)",
)

_BASELINE_TABLES = frozenset(
    {
        "agent_tasks",
        "attachments",
        "conversations",
        "events",
        "host_identity",
        "messages",
        "paired_devices",
        "pairing_sessions",
        "refresh_sessions",
        "todos",
        "user_settings",
    }
)


@dataclass(frozen=True)
class _SchemaFacts:
    """The table and column inventory a revision probe is allowed to use."""

    tables: frozenset[str]
    columns: Mapping[str, frozenset[str]]

    def has_column(self, table: str, column: str) -> bool:
        return column in self.columns.get(table, frozenset())


def _probe_baseline(facts: _SchemaFacts) -> bool:
    return _BASELINE_TABLES <= facts.tables


def _probe_canonical_task_status(facts: _SchemaFacts) -> bool:
    """Deliberately identical to the baseline probe.

    ``c5e936c9d7b1`` only adds the ``ck_todos_status_valid`` CHECK constraint,
    which SQLite can express only by rebuilding ``todos``. Rebuilding would drop
    and recreate the table and so cascade-delete every ``task_relationships``
    row that references it, along with every ``attachments`` row and every
    SET NULL link into ``todos``. That cannot be prevented from inside a
    revision: ``PRAGMA foreign_keys=OFF`` is a silent no-op within Alembic's
    transaction and ``defer_foreign_keys`` only defers reporting, not the
    cascade actions themselves.

    So the alias stays, and a legacy database still never receives the CHECK
    constraint itself. What it does receive is equivalent enforcement:
    revision ``a3f1c72b8d94`` installs BEFORE INSERT/UPDATE triggers on
    ``todos`` that reject the same values, and needs no table rewrite to do it.
    Together with the idempotent normalisation in ``f0d5c8a12b64``, an adopted
    database is guarded at the database level exactly like a fresh one -- the
    guarantee differs only in which SQLite object carries it.
    """
    return _probe_baseline(facts)


def _probe_normalized_task_relationships(facts: _SchemaFacts) -> bool:
    return {"task_relationships", "data_migration_markers"} <= facts.tables


def _probe_versioned_plan_proposals(facts: _SchemaFacts) -> bool:
    return {
        "task_graph_states",
        "plan_proposals",
        "change_sets",
        "vault_sync_jobs",
    } <= facts.tables


def _probe_first_class_projects(facts: _SchemaFacts) -> bool:
    return "projects" in facts.tables and facts.has_column("todos", "project_id")


def _probe_unified_review_and_artifacts(facts: _SchemaFacts) -> bool:
    return {"artifacts", "artifact_revisions", "review_items"} <= facts.tables


def _probe_agent_run_lifecycle(facts: _SchemaFacts) -> bool:
    return {"agent_runs", "agent_run_events"} <= facts.tables


def _probe_paseo_execution_provider(facts: _SchemaFacts) -> bool:
    return facts.has_column(
        "projects", "execution_workspace_isolation"
    ) and facts.has_column("agent_runs", "external_run_id")


def _probe_task_placement_changes(facts: _SchemaFacts) -> bool:
    return "task_placement_changes" in facts.tables


def _probe_message_idempotency_key(facts: _SchemaFacts) -> bool:
    return facts.has_column("messages", "idempotency_key")


# Revision chain order. Each entry answers "was this revision's schema already
# materialised by the pre-Alembic startup path?" using tables and columns only:
# those are what ``create_all`` guarantees, and probing them never requires a
# destructive table rebuild. A revision that changes no schema object (a pure
# data migration) needs no probe -- it simply runs during the upgrade that
# follows the stamp.
_LEGACY_REVISION_PROBES: tuple[tuple[str, Callable[[_SchemaFacts], bool]], ...] = (
    ("9927ab512428", _probe_baseline),
    ("c5e936c9d7b1", _probe_canonical_task_status),
    ("4d8f2a1c7b90", _probe_normalized_task_relationships),
    ("7a31c9e5d204", _probe_versioned_plan_proposals),
    ("1f6b9c4d2a70", _probe_first_class_projects),
    ("8c2d4e6f901b", _probe_unified_review_and_artifacts),
    ("b7e3a19d4c52", _probe_agent_run_lifecycle),
    ("c4a8e2f91d30", _probe_paseo_execution_provider),
    ("d6f8a1c3e520", _probe_task_placement_changes),
    ("e2b7c4d81a35", _probe_message_idempotency_key),
    # The list deliberately stops here rather than tracking head. Adoption
    # stamps at the *last* probe that passes, so a probe for a revision with
    # unprobed revisions before it would skip them: adding one for
    # d1e94a7c3f28 (calendar_feed_tokens) would strand f0d5c8a12b64's data
    # transforms and a3f1c72b8d94's status triggers on any database that
    # already had the table. A revision after this point that creates a table
    # must therefore be idempotent (guard on ``inspect(bind).has_table``)
    # instead of earning an entry here.
)

# The columns a probe may read. Reflecting every table on every startup is
# wasted work on a database that already carries an ``alembic_version`` row.
_PROBED_TABLES = ("todos", "messages", "projects", "agent_runs")


@dataclass(frozen=True)
class _StartupSchemaState:
    """Everything ``init_db`` must know *before* any migration runs."""

    tables: frozenset[str]
    current_revision: str | None
    relationship_table_exists: bool
    relationship_marker_exists: bool


def _alembic_config() -> Config:
    """Build the runtime Alembic config.

    Deliberately constructed without ``alembic.ini``: ``env.py`` calls
    ``fileConfig`` when a config file is present, which would tear down the
    application's own logging setup mid-startup. The CLI keeps using the ini.
    """
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    # ``env.py`` re-reads the URL from settings; set it too so the config is
    # self-contained and any Alembic internals see the same target.
    config.set_main_option(
        "sqlalchemy.url", settings.database_url.replace("%", "%%")
    )
    return config


def _read_startup_schema_state(sync_connection: Connection) -> _StartupSchemaState:
    inspector = inspect(sync_connection)
    tables = frozenset(inspector.get_table_names())

    current_revision: str | None = None
    if "alembic_version" in tables:
        current_revision = sync_connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalars().first()

    relationship_marker_exists = False
    if "data_migration_markers" in tables:
        relationship_marker_exists = (
            sync_connection.execute(
                text("SELECT 1 FROM data_migration_markers WHERE name = :name"),
                {"name": TASK_RELATIONSHIP_MIGRATION_MARKER},
            ).scalar_one_or_none()
            is not None
        )

    return _StartupSchemaState(
        tables=tables,
        current_revision=current_revision,
        relationship_table_exists="task_relationships" in tables,
        relationship_marker_exists=relationship_marker_exists,
    )


def _apply_legacy_baseline_corrections(sync_connection: Connection) -> None:
    """Lift a pre-Alembic schema onto the baseline revision's column set.

    Only ever runs for a database with no ``alembic_version`` row. Each
    statement is additive and idempotent; a duplicate column is expected and
    ignored, and each attempt is isolated in its own savepoint so one skipped
    statement cannot poison the rest.
    """
    for statement in _LEGACY_BASELINE_CORRECTIONS:
        savepoint = sync_connection.begin_nested()
        try:
            sync_connection.execute(text(statement))
        except DatabaseError:
            savepoint.rollback()
        else:
            savepoint.commit()


def _collect_schema_facts(sync_connection: Connection) -> _SchemaFacts:
    inspector = inspect(sync_connection)
    tables = frozenset(inspector.get_table_names())
    columns = {
        table: frozenset(
            column["name"] for column in inspector.get_columns(table)
        )
        for table in _PROBED_TABLES
        if table in tables
    }
    return _SchemaFacts(tables=tables, columns=columns)


def _detect_legacy_revision(facts: _SchemaFacts) -> str:
    """Map a pre-Alembic schema onto the revision that produced it.

    Fails closed. A schema that is not a clean prefix of the revision chain is
    an unrecognised database, and stamping it would either re-create existing
    tables or silently strand missing columns.
    """
    results = [(revision, probe(facts)) for revision, probe in _LEGACY_REVISION_PROBES]
    flags = [satisfied for _revision, satisfied in results]
    boundary = flags.index(False) if False in flags else len(flags)

    if any(flags[boundary:]):
        present = [revision for revision, satisfied in results if satisfied]
        missing = [revision for revision, satisfied in results if not satisfied]
        raise RuntimeError(
            "Refusing to migrate an unrecognised pre-Alembic database: its "
            "schema matches revisions "
            f"{', '.join(present)} but not {', '.join(missing)}, which is not a "
            "contiguous prefix of the migration history. Restore a backup or "
            "stamp the database manually with `alembic stamp <revision>`."
        )
    if boundary == 0:
        raise RuntimeError(
            "Refusing to migrate an unrecognised pre-Alembic database: the "
            "baseline tables "
            f"{', '.join(sorted(_BASELINE_TABLES - facts.tables))} are missing. "
            "Restore a backup or stamp the database manually with "
            "`alembic stamp <revision>`."
        )
    return results[boundary - 1][0]


async def _upgrade_schema_to_head(state: _StartupSchemaState) -> None:
    """Bring the database to the head revision, adopting legacy schemas first."""
    config = _alembic_config()

    is_pre_alembic = state.current_revision is None and bool(
        state.tables - {"alembic_version"}
    )
    if is_pre_alembic:
        async with engine.begin() as conn:
            await conn.run_sync(_apply_legacy_baseline_corrections)
            facts = await conn.run_sync(_collect_schema_facts)
        revision = _detect_legacy_revision(facts)
        logger.info(
            "Adopting pre-Alembic database: stamping revision %s", revision
        )
        # ``command.stamp``/``command.upgrade`` are synchronous and drive their
        # own event loop inside ``env.py``, so they must not run on this one.
        await asyncio.to_thread(command.stamp, config, revision)

    await asyncio.to_thread(command.upgrade, config, "head")


async def _run_data_migrations(
    session: AsyncSession,
    *,
    relationship_table_existed: bool = True,
):
    """Run idempotent transforms and reconcile normalized dependency state.

    The relationship marker is committed in the same transaction as the
    legacy import.  This makes an interrupted first startup retryable even
    after the normalized table already exists.  Once the marker exists,
    normalized rows are authoritative and only the legacy JSON shadow is
    reconciled.

    Column-level and value-level transforms live in Alembic revisions.  What
    remains here is reconciliation that must run on *every* startup, plus the
    object backfills that a revision cannot own: a revision only backfills when
    it creates its table, and a pre-Alembic database can already have the table
    without ever having been backfilled.  All of them are idempotent.
    """
    from models.data_migration_marker import DataMigrationMarker
    from services.tasks.task_relationship_service import (
        backfill_legacy_dependencies,
        reconcile_dependency_shadows,
    )

    marker = await session.get(
        DataMigrationMarker,
        TASK_RELATIONSHIP_MIGRATION_MARKER,
    )
    if marker is None:
        await backfill_legacy_dependencies(session)
        session.add(
            DataMigrationMarker(name=TASK_RELATIONSHIP_MIGRATION_MARKER)
        )
    else:
        if not relationship_table_existed:
            raise RuntimeError(
                "Task relationship migration marker exists but the "
                "task_relationships table was missing; refusing to overwrite "
                "legacy dependency data"
            )
        await reconcile_dependency_shadows(session)
    await _backfill_legacy_plan_proposals(session)
    await _backfill_first_class_projects(session)
    await _backfill_review_items(session)
    await _backfill_agent_runs(session)
    from services.agents.agent_run_service import reconcile_interrupted_runs

    await reconcile_interrupted_runs(session)
    await session.commit()


#: Root-todo sources that denote a workspace in their own right. ``project_root``
#: roots already belong to a Project; they are listed so a Project whose row
#: was lost regains one instead of leaving its tasks orphaned.
LEGACY_PROJECT_ROOT_SOURCES = frozenset({"obsidian_project", "project_root"})


async def _backfill_first_class_projects(session: AsyncSession) -> None:
    """Promote legacy root-Todo workspaces without changing task identity."""
    from collections import defaultdict, deque

    from models.conversation import Conversation
    from models.event import Event
    from models.plan_proposal import PlanProposal
    from models.project import Project
    from models.task_graph_state import TaskGraphState
    from models.todo import Todo
    from utils import make_id

    todos = list((await session.execute(select(Todo))).scalars().all())
    if not todos:
        return
    children: dict[str, list[Todo]] = defaultdict(list)
    for todo in todos:
        if todo.parent_id is not None:
            children[todo.parent_id].append(todo)

    conversations = list(
        (await session.execute(select(Conversation))).scalars().all()
    )
    linked_root_ids = {
        conversation.project_todo_id
        for conversation in conversations
        if conversation.project_todo_id is not None
    }
    projects = list((await session.execute(select(Project))).scalars().all())
    project_by_root_id = {
        project.root_task_id: project
        for project in projects
        if project.root_task_id is not None
    }
    global_state = await session.get(TaskGraphState, GLOBAL_TASK_GRAPH_SCOPE_ID)
    initial_revision = global_state.revision if global_state is not None else 0

    for root in sorted(todos, key=lambda item: (item.created_at, item.id)):
        if root.parent_id is not None:
            continue
        # Only a legacy workspace becomes a Project: a root with subtasks, one a
        # chat is scoped to, or an Obsidian project note. Any other source is
        # provenance, not structure -- every quick capture carries one, and
        # this runs on each startup, so matching them turned every capture
        # into an empty Project overnight.
        qualifies = (
            bool(children.get(root.id))
            or root.id in linked_root_ids
            or root.source in LEGACY_PROJECT_ROOT_SOURCES
        )
        if not qualifies:
            continue
        project = project_by_root_id.get(root.id)
        if project is None:
            project = Project(
                id=make_id("project_"),
                title=root.title,
                description=root.description,
                status=(
                    "completed"
                    if root.status == TaskStatus.COMPLETED
                    else "active"
                ),
                deadline=root.due_date,
                root_task_id=root.id,
                graph_revision=initial_revision,
                created_at=root.created_at,
                updated_at=root.updated_at,
            )
            session.add(project)
            project_by_root_id[root.id] = project

        queue = deque([root])
        while queue:
            todo = queue.popleft()
            if todo.project_id is None:
                todo.project_id = project.id
            queue.extend(children.get(todo.id, ()))

    await session.flush()
    project_by_root_id = {
        project.root_task_id: project
        for project in (await session.execute(select(Project))).scalars().all()
        if project.root_task_id is not None
    }
    for conversation in conversations:
        if conversation.project_id is None and conversation.project_todo_id is not None:
            project = project_by_root_id.get(conversation.project_todo_id)
            if project is not None:
                conversation.project_id = project.id

    await session.flush()
    conversation_projects = {
        conversation.id: conversation.project_id
        for conversation in conversations
        if conversation.project_id is not None
    }
    events = list((await session.execute(select(Event))).scalars().all())
    for event_row in events:
        if event_row.project_id is None and event_row.conversation_id is not None:
            event_row.project_id = conversation_projects.get(event_row.conversation_id)

    proposals = list(
        (await session.execute(select(PlanProposal))).scalars().all()
    )
    todo_projects = {todo.id: todo.project_id for todo in todos}
    for proposal in proposals:
        if proposal.project_id is None and proposal.root_task_id is not None:
            proposal.project_id = todo_projects.get(proposal.root_task_id)


async def _backfill_review_items(session: AsyncSession) -> None:
    """Mirror the Alembic plan-review backfill for legacy startup upgrades."""
    from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType
    from models.plan_proposal import PlanProposal
    from models.review_item import ReviewItem
    from utils import make_id

    existing_subject_ids = set(
        (
            await session.execute(
                select(ReviewItem.subject_id).where(
                    ReviewItem.subject_type == ReviewSubjectType.PLAN_PROPOSAL
                )
            )
        ).scalars().all()
    )
    proposals = list(
        (
            await session.execute(
                select(PlanProposal).where(
                    PlanProposal.status.notin_([
                        PlanProposalStatus.GENERATING,
                        PlanProposalStatus.FAILED,
                    ])
                )
            )
        ).scalars().all()
    )
    status_map = {
        PlanProposalStatus.DRAFT: ReviewStatus.PENDING,
        PlanProposalStatus.APPLYING: ReviewStatus.PENDING,
        PlanProposalStatus.APPLIED: ReviewStatus.APPROVED,
        PlanProposalStatus.REJECTED: ReviewStatus.REJECTED,
        PlanProposalStatus.STALE: ReviewStatus.EXPIRED,
        PlanProposalStatus.REVERTED: ReviewStatus.APPROVED,
    }
    for proposal in proposals:
        if proposal.id in existing_subject_ids:
            continue
        status = status_map[PlanProposalStatus(proposal.status)]
        reviewed_at = (
            None
            if status == ReviewStatus.PENDING
            else proposal.updated_at or datetime.now(timezone.utc)
        )
        session.add(
            ReviewItem(
                id=make_id("review_"),
                project_id=proposal.project_id,
                subject_type=ReviewSubjectType.PLAN_PROPOSAL,
                subject_id=proposal.id,
                status=status,
                summary="Review AI task plan",
                risk_level=ReviewRiskLevel.MEDIUM,
                requested_at=proposal.created_at,
                reviewed_at=reviewed_at,
                created_at=proposal.created_at,
                updated_at=proposal.updated_at,
            )
        )


async def _backfill_agent_runs(session: AsyncSession) -> None:
    """Create one durable historical attempt for legacy AgentTask rows."""
    from models.agent_run import AgentRun, AgentRunEvent
    from models.agent_task import AgentTask
    from models.conversation import Conversation
    from models.todo import Todo
    from utils import make_id

    existing_task_ids = set(
        (await session.execute(select(AgentRun.agent_task_id))).scalars().all()
    )
    tasks = list((await session.execute(select(AgentTask))).scalars().all())
    todo_projects = dict(
        (await session.execute(select(Todo.id, Todo.project_id))).all()
    )
    conversation_projects = dict(
        (await session.execute(select(Conversation.id, Conversation.project_id))).all()
    )
    now = datetime.now(timezone.utc)
    for task in tasks:
        if task.id in existing_task_ids:
            continue
        if task.status == "completed":
            status = "completed"
            adopted = True
            error = task.error
        elif task.status in ("failed", "cancelled"):
            status = task.status
            adopted = False
            error = task.error
        else:
            status = "failed"
            adopted = False
            error = "Legacy execution was interrupted; retry is available"
            task.status = "failed"
            task.error = error
            task.completed_at = now
        result = task.result or task.payload_json
        completed_at = task.completed_at or now
        run = AgentRun(
            id=make_id("run_"),
            agent_task_id=task.id,
            project_id=(
                todo_projects.get(task.todo_id)
                or conversation_projects.get(task.conversation_id)
            ),
            attempt=1,
            instruction_snapshot=task.instruction,
            provider="legacy",
            status=status,
            progress=100 if status == "completed" else task.progress,
            progress_message=task.progress_message,
            result=result,
            result_summary=result[:500] if result else None,
            error=error,
            is_adopted=adopted,
            created_at=task.created_at,
            started_at=task.started_at,
            heartbeat_at=task.completed_at or task.started_at,
            completed_at=completed_at,
            updated_at=completed_at,
        )
        session.add(run)
        session.add(
            AgentRunEvent(
                id=make_id("run_event_"),
                run_id=run.id,
                sequence=1,
                event_type="migrated",
                message="Imported from legacy AgentTask state",
                progress=run.progress,
                created_at=completed_at,
            )
        )


async def _backfill_legacy_plan_proposals(session: AsyncSession) -> None:
    """Retain completed legacy planner runs on compatibility-only upgrades.

    Packaged and older self-hosted installations historically upgraded through
    ``init_db`` rather than Alembic.  ``create_all`` creates the PR3 tables for
    those databases, so this idempotent transform must mirror the Alembic
    backfill instead of making existing plan history disappear from the API.
    Imported history never receives a fabricated graph revision or undo log.
    """
    from models.agent_task import AgentTask
    from models.plan_proposal import PlanProposal
    from models.task_relationship import TaskRelationship

    existing_proposals = list(
        (await session.execute(select(PlanProposal))).scalars().all()
    )
    proposal_by_id = {proposal.id: proposal for proposal in existing_proposals}
    proposal_by_agent_task_id = {
        proposal.agent_task_id: proposal
        for proposal in existing_proposals
        if proposal.agent_task_id is not None
    }
    legacy_tasks = list(
        (
            await session.execute(
                select(AgentTask)
                .where(
                    AgentTask.task_type == "plan_todo",
                    AgentTask.status == "completed",
                )
                .order_by(AgentTask.created_at, AgentTask.id)
            )
        ).scalars().all()
    )
    eligible_agent_task_ids = {task.id for task in legacy_tasks}
    referenced_ids = set(
        (
            await session.execute(
                select(TaskRelationship.proposal_id).where(
                    TaskRelationship.proposal_id.is_not(None)
                )
            )
        ).scalars().all()
    )
    invalid_references = sorted(
        referenced_ids
        - eligible_agent_task_ids
        - set(proposal_by_id)
    )
    if invalid_references:
        raise RuntimeError(
            "Cannot migrate task relationship proposal references that do not "
            "point to completed plan_todo agent tasks or existing proposals: "
            + ", ".join(invalid_references)
        )

    now = datetime.now(timezone.utc)
    for task in legacy_tasks:
        existing_for_task = proposal_by_agent_task_id.get(task.id)
        existing_for_id = proposal_by_id.get(task.id)
        if existing_for_task is not None:
            continue
        if existing_for_id is not None:
            raise RuntimeError(
                "Cannot retain legacy plan history because proposal ID "
                f"{task.id} is already owned by another agent task"
            )

        parse_error: str | None = None
        try:
            payload = json.loads(task.payload_json) if task.payload_json else None
            if not isinstance(payload, dict):
                raise TypeError("payload_json must contain a JSON object")
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            parse_error = str(exc)

        if parse_error is not None:
            status = PlanProposalStatus.FAILED
        elif task.id in referenced_ids:
            status = PlanProposalStatus.APPLIED
        else:
            status = PlanProposalStatus.STALE
        validation_detail: dict[str, object] = {
            "legacy": True,
            "source": "agent_tasks",
            "base_graph_revision_available": False,
        }
        if parse_error is not None:
            validation_detail["error"] = parse_error
        elif status == PlanProposalStatus.APPLIED:
            validation_detail["reason"] = (
                "relationship_reference_without_change_set"
            )
        else:
            validation_detail["reason"] = (
                "legacy_proposal_requires_regeneration"
            )

        created_at = task.created_at or now
        completed_at = task.completed_at or created_at
        proposal = PlanProposal(
            id=task.id,
            root_task_id=task.todo_id,
            agent_task_id=task.id,
            base_graph_revision=None,
            prompt_version="legacy-agent-task-v1",
            payload_json=task.payload_json,
            validation_json=json.dumps(
                validation_detail,
                ensure_ascii=False,
                sort_keys=True,
            ),
            status=status,
            is_revertible=False,
            created_at=created_at,
            updated_at=completed_at,
            applied_at=(
                completed_at if status == PlanProposalStatus.APPLIED else None
            ),
        )
        session.add(proposal)
        proposal_by_id[proposal.id] = proposal
        proposal_by_agent_task_id[task.id] = proposal


async def _setup_task_relationship_integrity(session: AsyncSession) -> None:
    """Install SQLite triggers that atomically reject dependency cycles."""
    bind = session.get_bind()
    if bind.dialect.name != "sqlite":
        return
    for statement in _TASK_RELATIONSHIP_CYCLE_TRIGGERS:
        await session.execute(text(statement))
    await session.commit()


async def _setup_task_graph_revision(session: AsyncSession) -> None:
    """Ensure the global revision row and SQLite trigger parity at startup."""
    async_connection = await session.connection()
    await async_connection.run_sync(_install_task_graph_state_sync)
    await session.commit()


async def _setup_fts(session: AsyncSession):
    """Create FTS5 tables and sync triggers, and rebuild any index that drifted."""
    for name in _LEGACY_FTS5_TRIGGERS:
        await session.execute(text(f"DROP TRIGGER IF EXISTS {name}"))
    for index in _FTS_INDEXES:
        await session.execute(text(_fts_virtual_table_sql(index)))
        for statement in _fts_triggers(index):
            await session.execute(text(statement))
        if (await session.execute(text(_fts_drift_sql(index)))).scalar():
            await rebuild_fts_index(session, index)
    await session.commit()


async def rebuild_fts_index(session: AsyncSession, index: _FtsIndex) -> None:
    """Refill one FTS index from its source table, without committing."""
    for statement in _fts_rebuild_sql(index):
        await session.execute(text(statement))


async def rebuild_fts(session: AsyncSession) -> list[str]:
    """Refill every FTS index from its source table and commit."""
    for index in _FTS_INDEXES:
        await rebuild_fts_index(session, index)
    await session.commit()
    return [index.table for index in _FTS_INDEXES]


async def init_db():
    """Migrate the database to head, then install the non-declarative objects.

    Alembic owns the schema. FTS5 virtual tables, their sync triggers, the
    dependency-cycle triggers, and the task-graph revision triggers are
    re-asserted afterwards: none of them can be expressed in ORM metadata, all
    of them are ``IF NOT EXISTS`` idempotent, and re-asserting them heals a
    database restored from a dump that carried tables but no triggers.
    """
    _ensure_data_dir()

    async with engine.begin() as conn:
        from models import _register_all  # noqa: F401

        state = await conn.run_sync(_read_startup_schema_state)

    # Fail closed before any DDL runs. A marker without its table means the
    # normalized dependency rows were lost; recreating an empty table would let
    # the reconciler overwrite the legacy JSON shadow with nothing.
    if state.relationship_marker_exists and not state.relationship_table_exists:
        raise RuntimeError(
            "Task relationship migration marker exists but the "
            "task_relationships table is missing; refusing to recreate "
            "an empty table over legacy dependency data"
        )

    await _upgrade_schema_to_head(state)

    async with AsyncSession(engine) as session:
        await _setup_task_relationship_integrity(session)
        await _run_data_migrations(
            session,
            # The guard above already rejected "marker without table". Anything
            # the migrations just created is, by construction, backfilled by the
            # revision that created it.
            relationship_table_existed=(
                state.relationship_table_exists
                or not state.relationship_marker_exists
            ),
        )
        await _setup_task_graph_revision(session)
        await _setup_fts(session)


async def get_db():
    async with async_session_factory() as session:
        yield session
