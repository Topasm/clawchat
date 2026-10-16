"""Indexes for the hot query paths, and rowid-keyed full-text search.

The FTS5 indexes used to find a row through their UNINDEXED ``id`` column, so
every todo, event or message update scanned a whole index. They now share the
source row's rowid. This revision drops the old indexes and their triggers;
``database._setup_fts`` recreates both at startup and refills the indexes from
the source tables, so search returns the same rows.

Revision ID: 5e0a7c3d9b14
Revises: e3a7c5f19b28
"""

from alembic import op
import sqlalchemy as sa

revision = "5e0a7c3d9b14"
down_revision = "e3a7c5f19b28"
branch_labels = None
depends_on = None

_FTS_SOURCES = ("messages", "todos", "events")

# (table, index name, columns) added by this revision.
_NEW_INDEXES = (
    ("messages", "idx_messages_conversation_created", ["conversation_id", "created_at"]),
    (
        "agent_runs",
        "idx_agent_runs_host_status_created",
        ["execution_host_id", "status", "created_at"],
    ),
    ("todos", "idx_todos_created_at", ["created_at"]),
    ("todos", "idx_todos_updated_at", ["updated_at"]),
    ("todos", "idx_todos_message_id", ["message_id"]),
    ("todos", "idx_todos_recurring_source_id", ["recurring_source_id"]),
    ("agent_tasks", "idx_agent_tasks_todo_id", ["todo_id"]),
    ("agent_tasks", "idx_agent_tasks_message_id", ["message_id"]),
    ("events", "idx_events_message_id", ["message_id"]),
    ("events", "idx_events_recurring_event_id", ["recurring_event_id"]),
    ("calendar_pushes", "ix_calendar_pushes_event_id", ["event_id"]),
    ("scheduled_jobs", "ix_scheduled_jobs_conversation_id", ["conversation_id"]),
    ("scheduled_jobs", "ix_scheduled_jobs_last_run_id", ["last_run_id"]),
)

# (table, index name, columns) the new composite indexes lead with.
_REPLACED_INDEXES = (
    ("messages", "idx_messages_conversation_id", ["conversation_id"]),
    ("agent_runs", "idx_agent_runs_execution_host_id", ["execution_host_id"]),
)


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def _drop_fts_objects(trigger_names: list[str]) -> None:
    if op.get_bind().dialect.name != "sqlite":
        return
    for name in trigger_names:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")
    for source in _FTS_SOURCES:
        op.execute(f"DROP TABLE IF EXISTS {source}_fts")


def upgrade():
    for table, name, columns in _NEW_INDEXES:
        if name not in _index_names(table):
            op.create_index(name, table, columns)
    for table, name, _columns in _REPLACED_INDEXES:
        if name in _index_names(table):
            op.drop_index(name, table_name=table)

    _drop_fts_objects(
        [f"{source}_{suffix}" for source in _FTS_SOURCES for suffix in ("ai", "au", "ad")]
    )


def downgrade():
    for table, name, columns in _REPLACED_INDEXES:
        if name not in _index_names(table):
            op.create_index(name, table, columns)
    for table, name, _columns in reversed(_NEW_INDEXES):
        if name in _index_names(table):
            op.drop_index(name, table_name=table)

    # The previous release recreates its id-keyed indexes at startup.
    _drop_fts_objects(
        [
            f"{source}_fts_{suffix}"
            for source in _FTS_SOURCES
            for suffix in ("ai", "au", "ad")
        ]
    )
