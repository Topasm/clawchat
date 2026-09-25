"""Standalone Inbox and project notes.

Revision ID: c3e8f6a12b49
Revises: b2d4f6a8c013
"""

from alembic import op
import sqlalchemy as sa

revision = "c3e8f6a12b49"
down_revision = "b2d4f6a8c013"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("notes"):
        return
    op.create_table(
        "notes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "project_id",
            sa.String(),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("idempotency_key", sa.String(64), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_notes_project_id", "notes", ["project_id"])


def downgrade():
    op.drop_table("notes")
