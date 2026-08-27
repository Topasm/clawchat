"""add durable agent run lifecycle and event log

Revision ID: b7e3a19d4c52
Revises: 8c2d4e6f901b
Create Date: 2026-08-28 00:15:00.000000
"""

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "b7e3a19d4c52"
down_revision: Union[str, Sequence[str], None] = "8c2d4e6f901b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_task_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("instruction_snapshot", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("host_id", sa.String(), nullable=True),
        sa.Column("workspace_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), server_default="queued", nullable=False),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("progress_message", sa.Text(), nullable=True),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("usage_json", sa.Text(), nullable=True),
        sa.Column("is_adopted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('queued', 'starting', 'running', 'waiting_input', 'waiting_review', 'completed', 'failed', 'cancelled')", name="ck_agent_runs_status"),
        sa.CheckConstraint("attempt >= 1", name="ck_agent_runs_attempt"),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_agent_runs_progress"),
        sa.ForeignKeyConstraint(["agent_task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_task_id", "attempt", name="uq_agent_runs_task_attempt"),
    )
    op.create_index("idx_agent_runs_status_created", "agent_runs", ["status", "created_at"])
    op.create_index("idx_agent_runs_project_status", "agent_runs", ["project_id", "status"])
    op.create_index("idx_agent_runs_task_created", "agent_runs", ["agent_task_id", "created_at"])

    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("progress", sa.Integer(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("progress IS NULL OR (progress >= 0 AND progress <= 100)", name="ck_agent_run_events_progress"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_agent_run_events_sequence"),
    )
    op.create_index("idx_agent_run_events_run_sequence", "agent_run_events", ["run_id", "sequence"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    rows = list(bind.execute(sa.text("""
        SELECT agent_tasks.*, todos.project_id AS todo_project_id,
               conversations.project_id AS conversation_project_id
        FROM agent_tasks
        LEFT JOIN todos ON todos.id = agent_tasks.todo_id
        LEFT JOIN conversations ON conversations.id = agent_tasks.conversation_id
        ORDER BY agent_tasks.created_at, agent_tasks.id
    """)).mappings())
    for task in rows:
        original_status = task["status"]
        if original_status == "completed":
            run_status = "completed"
            adopted = True
            error = task["error"]
        elif original_status in ("failed", "cancelled"):
            run_status = original_status
            adopted = False
            error = task["error"]
        else:
            run_status = "failed"
            adopted = False
            error = "Legacy execution was interrupted; retry is available"
            bind.execute(sa.text("""
                UPDATE agent_tasks SET status = 'failed', error = :error,
                    completed_at = :completed_at WHERE id = :id
            """), {"id": task["id"], "error": error, "completed_at": now})
        run_id = _id("run_")
        created_at = task["created_at"] or now
        completed_at = task["completed_at"] or now
        result = task["result"] or task["payload_json"]
        bind.execute(sa.text("""
            INSERT INTO agent_runs (
                id, agent_task_id, project_id, attempt, instruction_snapshot,
                provider, model, host_id, workspace_id, status, progress,
                progress_message, result, result_summary, error, usage_json,
                is_adopted, created_at, started_at, heartbeat_at, completed_at,
                cancel_requested_at, updated_at
            ) VALUES (
                :id, :agent_task_id, :project_id, 1, :instruction,
                'legacy', NULL, NULL, NULL, :status, :progress,
                :progress_message, :result, :result_summary, :error, NULL,
                :is_adopted, :created_at, :started_at, :heartbeat_at,
                :completed_at, NULL, :updated_at
            )
        """), {
            "id": run_id,
            "agent_task_id": task["id"],
            "project_id": task["todo_project_id"] or task["conversation_project_id"],
            "instruction": task["instruction"],
            "status": run_status,
            "progress": 100 if run_status == "completed" else task["progress"] or 0,
            "progress_message": task["progress_message"],
            "result": result,
            "result_summary": result[:500] if result else None,
            "error": error,
            "is_adopted": adopted,
            "created_at": created_at,
            "started_at": task["started_at"],
            "heartbeat_at": task["completed_at"] or task["started_at"],
            "completed_at": completed_at,
            "updated_at": completed_at,
        })
        bind.execute(sa.text("""
            INSERT INTO agent_run_events (
                id, run_id, sequence, event_type, message, progress,
                payload_json, created_at
            ) VALUES (
                :id, :run_id, 1, :event_type, :message, :progress, NULL, :created_at
            )
        """), {
            "id": _id("run_event_"),
            "run_id": run_id,
            "event_type": "migrated",
            "message": "Imported from legacy AgentTask state",
            "progress": 100 if run_status == "completed" else task["progress"] or 0,
            "created_at": completed_at,
        })


def downgrade() -> None:
    op.drop_index("idx_agent_run_events_run_sequence", table_name="agent_run_events")
    op.drop_table("agent_run_events")
    op.drop_index("idx_agent_runs_task_created", table_name="agent_runs")
    op.drop_index("idx_agent_runs_project_status", table_name="agent_runs")
    op.drop_index("idx_agent_runs_status_created", table_name="agent_runs")
    op.drop_table("agent_runs")
