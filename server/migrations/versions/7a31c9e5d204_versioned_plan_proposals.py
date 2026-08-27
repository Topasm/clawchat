"""add versioned plan proposals, change sets, and vault outbox

Revision ID: 7a31c9e5d204
Revises: 4d8f2a1c7b90
Create Date: 2026-08-27 21:00:00.000000

"""

import json
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7a31c9e5d204"
down_revision: Union[str, Sequence[str], None] = "4d8f2a1c7b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_GLOBAL_SCOPE_ID = "global"
_PLAN_STATUSES = (
    "generating",
    "draft",
    "applying",
    "applied",
    "rejected",
    "stale",
    "reverted",
    "failed",
)
_CHANGE_SET_STATUSES = ("applying", "applied", "reverted", "failed")
_VAULT_JOB_STATUSES = ("pending", "processing", "succeeded", "failed")


def _status_check(column: str, values: tuple[str, ...]) -> str:
    serialized = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({serialized})"


_TODO_SEMANTIC_COLUMNS = (
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
_TODO_UPDATE_COLUMNS_SQL = ", ".join(_TODO_SEMANTIC_COLUMNS)
_TODO_CHANGED_SQL = " OR ".join(
    f"OLD.{column} IS NOT NEW.{column}" for column in _TODO_SEMANTIC_COLUMNS
)
_REVISION_UPDATE_SQL = f"""
    UPDATE task_graph_states
    SET revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE scope_id = '{_GLOBAL_SCOPE_ID}';
"""

_REVISION_TRIGGERS = {
    "todos_bump_task_graph_revision_insert": f"""
        CREATE TRIGGER todos_bump_task_graph_revision_insert
        AFTER INSERT ON todos
        BEGIN
            {_REVISION_UPDATE_SQL}
        END
    """,
    "todos_bump_task_graph_revision_delete": f"""
        CREATE TRIGGER todos_bump_task_graph_revision_delete
        AFTER DELETE ON todos
        BEGIN
            {_REVISION_UPDATE_SQL}
        END
    """,
    "todos_bump_task_graph_revision_update": f"""
        CREATE TRIGGER todos_bump_task_graph_revision_update
        AFTER UPDATE OF {_TODO_UPDATE_COLUMNS_SQL} ON todos
        WHEN {_TODO_CHANGED_SQL}
        BEGIN
            {_REVISION_UPDATE_SQL}
        END
    """,
    "task_relationships_bump_graph_revision_insert": f"""
        CREATE TRIGGER task_relationships_bump_graph_revision_insert
        AFTER INSERT ON task_relationships
        BEGIN
            {_REVISION_UPDATE_SQL}
        END
    """,
    "task_relationships_bump_graph_revision_update": f"""
        CREATE TRIGGER task_relationships_bump_graph_revision_update
        AFTER UPDATE ON task_relationships
        BEGIN
            {_REVISION_UPDATE_SQL}
        END
    """,
    "task_relationships_bump_graph_revision_delete": f"""
        CREATE TRIGGER task_relationships_bump_graph_revision_delete
        AFTER DELETE ON task_relationships
        BEGIN
            {_REVISION_UPDATE_SQL}
        END
    """,
}


def _legacy_proposal_sources(bind):
    referenced_ids = set(
        bind.execute(
            sa.text(
                "SELECT DISTINCT proposal_id FROM task_relationships "
                "WHERE proposal_id IS NOT NULL"
            )
        ).scalars()
    )
    rows = list(
        bind.execute(
            sa.text(
                "SELECT id, todo_id, payload_json, created_at, completed_at "
                "FROM agent_tasks "
                "WHERE task_type = 'plan_todo' AND status = 'completed' "
                "ORDER BY created_at, id"
            )
        )
    )
    eligible_agent_task_ids = {row.id for row in rows}
    invalid_references = sorted(referenced_ids - eligible_agent_task_ids)
    if invalid_references:
        raise RuntimeError(
            "Cannot migrate task relationship proposal references that do "
            "not point to completed plan_todo agent tasks: "
            + ", ".join(invalid_references)
        )
    return rows, referenced_ids


def _legacy_validation_json(*, status: str, error: str | None = None) -> str:
    detail: dict[str, object] = {
        "legacy": True,
        "source": "agent_tasks",
        "base_graph_revision_available": False,
    }
    if error is not None:
        detail["error"] = error
    elif status == "applied":
        detail["reason"] = "relationship_reference_without_change_set"
    else:
        detail["reason"] = "legacy_proposal_requires_regeneration"
    return json.dumps(detail, ensure_ascii=False, sort_keys=True)


def _legacy_datetime(value, *, fallback: datetime) -> datetime:
    """Normalize untyped SQLite text-query timestamps for bulk insertion."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return fallback


def _backfill_legacy_proposals(
    bind,
    rows,
    referenced_ids: set[str],
) -> None:
    if not rows:
        return

    proposal_table = sa.table(
        "plan_proposals",
        sa.column("id", sa.String()),
        sa.column("root_task_id", sa.String()),
        sa.column("agent_task_id", sa.String()),
        sa.column("base_graph_revision", sa.Integer()),
        sa.column("model_provider", sa.String()),
        sa.column("model_name", sa.String()),
        sa.column("prompt_version", sa.String()),
        sa.column("context_hash", sa.String()),
        sa.column("payload_json", sa.Text()),
        sa.column("validation_json", sa.Text()),
        sa.column("status", sa.String()),
        sa.column("is_revertible", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("applied_at", sa.DateTime(timezone=True)),
    )
    proposals: list[dict[str, object]] = []
    now = datetime.now(timezone.utc)
    for row in rows:
        parse_error: str | None = None
        try:
            payload = json.loads(row.payload_json) if row.payload_json else None
            if not isinstance(payload, dict):
                raise ValueError("payload_json must contain a JSON object")
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            parse_error = str(exc)

        if parse_error is not None:
            status = "failed"
        elif row.id in referenced_ids:
            status = "applied"
        else:
            status = "stale"

        created_at = _legacy_datetime(row.created_at, fallback=now)
        completed_at = _legacy_datetime(
            row.completed_at,
            fallback=created_at,
        )
        proposals.append(
            {
                "id": row.id,
                "root_task_id": row.todo_id,
                "agent_task_id": row.id,
                "base_graph_revision": None,
                "model_provider": None,
                "model_name": None,
                "prompt_version": "legacy-agent-task-v1",
                "context_hash": None,
                "payload_json": row.payload_json,
                "validation_json": _legacy_validation_json(
                    status=status,
                    error=parse_error,
                ),
                "status": status,
                "is_revertible": False,
                "created_at": created_at,
                "updated_at": completed_at,
                "applied_at": completed_at if status == "applied" else None,
            }
        )
    op.bulk_insert(proposal_table, proposals)


def upgrade() -> None:
    bind = op.get_bind()
    legacy_rows, referenced_ids = _legacy_proposal_sources(bind)

    op.create_table(
        "task_graph_states",
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "revision >= 0",
            name="ck_task_graph_states_revision_nonnegative",
        ),
        sa.PrimaryKeyConstraint("scope_id"),
    )
    graph_state_table = sa.table(
        "task_graph_states",
        sa.column("scope_id", sa.String()),
        sa.column("revision", sa.Integer()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        graph_state_table,
        [
            {
                "scope_id": _GLOBAL_SCOPE_ID,
                "revision": 0,
                "updated_at": datetime.now(timezone.utc),
            }
        ],
    )

    op.create_table(
        "plan_proposals",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("root_task_id", sa.String(), nullable=True),
        sa.Column("agent_task_id", sa.String(), nullable=True),
        sa.Column("base_graph_revision", sa.Integer(), nullable=True),
        sa.Column("model_provider", sa.String(), nullable=True),
        sa.Column("model_name", sa.String(), nullable=True),
        sa.Column("prompt_version", sa.String(), nullable=True),
        sa.Column("context_hash", sa.String(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("validation_json", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(),
            server_default="generating",
            nullable=False,
        ),
        sa.Column(
            "is_revertible",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            _status_check("status", _PLAN_STATUSES),
            name="ck_plan_proposals_status_valid",
        ),
        sa.CheckConstraint(
            "base_graph_revision IS NULL OR base_graph_revision >= 0",
            name="ck_plan_proposals_base_revision_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["root_task_id"],
            ["todos.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["agent_task_id"],
            ["agent_tasks.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "agent_task_id",
            name="uq_plan_proposals_agent_task_id",
        ),
    )
    op.create_index(
        "idx_plan_proposals_root_status",
        "plan_proposals",
        ["root_task_id", "status"],
        unique=False,
    )
    op.create_index(
        "idx_plan_proposals_created_at",
        "plan_proposals",
        ["created_at"],
        unique=False,
    )

    op.create_table(
        "change_sets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("proposal_id", sa.String(), nullable=False),
        sa.Column("request_hash", sa.String(), nullable=False),
        sa.Column("base_graph_revision", sa.Integer(), nullable=False),
        sa.Column("applied_graph_revision", sa.Integer(), nullable=True),
        sa.Column("reverted_graph_revision", sa.Integer(), nullable=True),
        sa.Column(
            "operations_json",
            sa.Text(),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "inverse_operations_json",
            sa.Text(),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("response_json", sa.Text(), nullable=True),
        sa.Column("undo_response_json", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(),
            server_default="applying",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            _status_check("status", _CHANGE_SET_STATUSES),
            name="ck_change_sets_status_valid",
        ),
        sa.CheckConstraint(
            "base_graph_revision >= 0",
            name="ck_change_sets_base_revision_nonnegative",
        ),
        sa.CheckConstraint(
            "applied_graph_revision IS NULL OR applied_graph_revision >= 0",
            name="ck_change_sets_applied_revision_nonnegative",
        ),
        sa.CheckConstraint(
            "reverted_graph_revision IS NULL OR reverted_graph_revision >= 0",
            name="ck_change_sets_reverted_revision_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id"],
            ["plan_proposals.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("proposal_id", name="uq_change_sets_proposal_id"),
    )
    op.create_index(
        "idx_change_sets_status",
        "change_sets",
        ["status"],
        unique=False,
    )

    op.create_table(
        "vault_sync_jobs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("change_set_id", sa.String(), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("aggregate_id", sa.String(), nullable=False),
        sa.Column(
            "payload_json",
            sa.Text(),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("dedupe_key", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.String(),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            _status_check("status", _VAULT_JOB_STATUSES),
            name="ck_vault_sync_jobs_status_valid",
        ),
        sa.CheckConstraint(
            "attempts >= 0",
            name="ck_vault_sync_jobs_attempts_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["change_set_id"],
            ["change_sets.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dedupe_key",
            name="uq_vault_sync_jobs_dedupe_key",
        ),
    )
    op.create_index(
        "idx_vault_sync_jobs_delivery",
        "vault_sync_jobs",
        ["status", "available_at"],
        unique=False,
    )
    op.create_index(
        "idx_vault_sync_jobs_change_set_id",
        "vault_sync_jobs",
        ["change_set_id"],
        unique=False,
    )

    _backfill_legacy_proposals(bind, legacy_rows, referenced_ids)
    if bind.dialect.name == "sqlite":
        for statement in _REVISION_TRIGGERS.values():
            op.execute(statement)


def _count(bind, statement: str) -> int:
    return int(bind.execute(sa.text(statement)).scalar_one())


def downgrade() -> None:
    bind = op.get_bind()

    undelivered_jobs = _count(
        bind,
        "SELECT COUNT(*) FROM vault_sync_jobs WHERE status <> 'succeeded'",
    )
    if undelivered_jobs:
        raise RuntimeError(
            "Cannot downgrade with pending or failed vault sync jobs: "
            f"{undelivered_jobs}"
        )

    non_reverted_change_sets = _count(
        bind,
        "SELECT COUNT(*) FROM change_sets WHERE status <> 'reverted'",
    )
    if non_reverted_change_sets:
        raise RuntimeError(
            "Cannot downgrade without losing non-reverted change-set history: "
            f"{non_reverted_change_sets}"
        )

    proposal_history = _count(bind, "SELECT COUNT(*) FROM plan_proposals")
    if proposal_history:
        raise RuntimeError(
            "Cannot downgrade without losing plan proposal history: "
            f"{proposal_history}"
        )

    if bind.dialect.name == "sqlite":
        for trigger_name in reversed(tuple(_REVISION_TRIGGERS)):
            op.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")

    op.drop_index(
        "idx_vault_sync_jobs_change_set_id",
        table_name="vault_sync_jobs",
    )
    op.drop_index(
        "idx_vault_sync_jobs_delivery",
        table_name="vault_sync_jobs",
    )
    op.drop_table("vault_sync_jobs")
    op.drop_index("idx_change_sets_status", table_name="change_sets")
    op.drop_table("change_sets")
    op.drop_index(
        "idx_plan_proposals_created_at",
        table_name="plan_proposals",
    )
    op.drop_index(
        "idx_plan_proposals_root_status",
        table_name="plan_proposals",
    )
    op.drop_table("plan_proposals")
    op.drop_table("task_graph_states")
