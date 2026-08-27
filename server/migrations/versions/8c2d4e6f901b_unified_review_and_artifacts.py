"""add unified review inbox and versioned artifacts

Revision ID: 8c2d4e6f901b
Revises: 1f6b9c4d2a70
Create Date: 2026-08-27 23:30:00.000000
"""

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "8c2d4e6f901b"
down_revision: Union[str, Sequence[str], None] = "1f6b9c4d2a70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("current_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("source", sa.String(), server_default="human", nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("type IN ('project_brief', 'requirements', 'acceptance_criteria', 'research_note', 'decision', 'report', 'code_diff', 'generated_file', 'external_link')", name="ck_artifacts_type"),
        sa.CheckConstraint("current_version >= 1", name="ck_artifacts_current_version"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["todos.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_artifacts_project_updated", "artifacts", ["project_id", "updated_at"])
    op.create_index("idx_artifacts_task", "artifacts", ["task_id"])

    op.create_table(
        "artifact_revisions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("artifact_id", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("source", sa.String(), server_default="human", nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('approved', 'pending', 'changes_requested', 'rejected')", name="ck_artifact_revisions_status"),
        sa.CheckConstraint("version >= 1", name="ck_artifact_revisions_version"),
        sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_id", "version", name="uq_artifact_revisions_version"),
    )
    op.create_index("idx_artifact_revisions_artifact_created", "artifact_revisions", ["artifact_id", "created_at"])

    op.create_table(
        "review_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("subject_type", sa.String(), nullable=False),
        sa.Column("subject_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("risk_level", sa.String(), server_default="medium", nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("subject_type IN ('plan_proposal', 'artifact_revision', 'agent_run', 'code_diff', 'schedule_change', 'sync_conflict')", name="ck_review_items_subject_type"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'changes_requested', 'rejected', 'expired')", name="ck_review_items_status"),
        sa.CheckConstraint("risk_level IN ('low', 'medium', 'high')", name="ck_review_items_risk"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("subject_type", "subject_id", name="uq_review_items_subject"),
    )
    op.create_index("idx_review_items_status_requested", "review_items", ["status", "requested_at"])
    op.create_index("idx_review_items_project_status", "review_items", ["project_id", "status"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    rows = bind.execute(sa.text(
        "SELECT id, project_id, root_task_id, status, created_at, updated_at "
        "FROM plan_proposals WHERE status NOT IN ('generating', 'failed')"
    )).mappings()
    status_map = {
        "draft": "pending",
        "applying": "pending",
        "applied": "approved",
        "rejected": "rejected",
        "stale": "expired",
        "reverted": "approved",
    }
    for row in rows:
        review_status = status_map[row["status"]]
        reviewed_at = None if review_status == "pending" else (row["updated_at"] or now)
        bind.execute(sa.text("""
            INSERT INTO review_items (
                id, project_id, subject_type, subject_id, status, summary,
                risk_level, requested_at, reviewed_at, review_note, created_at, updated_at
            ) VALUES (
                :id, :project_id, 'plan_proposal', :subject_id, :status,
                'Review AI task plan', 'medium', :requested_at, :reviewed_at,
                NULL, :created_at, :updated_at
            )
        """), {
            "id": f"review_{uuid.uuid4().hex[:12]}",
            "project_id": row["project_id"],
            "subject_id": row["id"],
            "status": review_status,
            "requested_at": row["created_at"] or now,
            "reviewed_at": reviewed_at,
            "created_at": row["created_at"] or now,
            "updated_at": row["updated_at"] or now,
        })


def downgrade() -> None:
    op.drop_index("idx_review_items_project_status", table_name="review_items")
    op.drop_index("idx_review_items_status_requested", table_name="review_items")
    op.drop_table("review_items")
    op.drop_index("idx_artifact_revisions_artifact_created", table_name="artifact_revisions")
    op.drop_table("artifact_revisions")
    op.drop_index("idx_artifacts_task", table_name="artifacts")
    op.drop_index("idx_artifacts_project_updated", table_name="artifacts")
    op.drop_table("artifacts")
