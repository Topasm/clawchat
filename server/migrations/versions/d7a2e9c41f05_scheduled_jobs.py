"""Scheduled AI jobs.

Revision ID: d7a2e9c41f05
Revises: c3e8f6a12b49
"""

from alembic import op
import sqlalchemy as sa

revision = "d7a2e9c41f05"
down_revision = "c3e8f6a12b49"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("scheduled_jobs"):
        return
    op.create_table(
        "scheduled_jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("skill_chain", sa.Text(), nullable=False),
        sa.Column(
            "project_id",
            sa.String(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("include_task_snapshot", sa.Boolean(), nullable=False),
        sa.Column("rrule", sa.Text(), nullable=False),
        sa.Column("timezone", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "last_run_id",
            sa.String(),
            sa.ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_scheduled_jobs_due", "scheduled_jobs", ["enabled", "next_run_at"]
    )
    op.create_index(
        "ix_scheduled_jobs_project_id", "scheduled_jobs", ["project_id"]
    )


def downgrade():
    op.drop_table("scheduled_jobs")
