"""Inbox routings: where each capture went, by the server or the user, and
how to put it back.

Revision ID: b7e2c4a9d153
Revises: a8d3f1c6e290
"""

from alembic import op
import sqlalchemy as sa

revision = "b7e2c4a9d153"
down_revision = "a8d3f1c6e290"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("inbox_routings"):
        return
    op.create_table(
        "inbox_routings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("todo_id", sa.String(), nullable=True),
        sa.Column("note_id", sa.String(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("original_title", sa.Text(), nullable=False),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("project_folder", sa.Text(), nullable=True),
        sa.Column("before_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("origin IN ('auto', 'user')", name="ck_inbox_routings_origin"),
        sa.CheckConstraint("kind IN ('task', 'note')", name="ck_inbox_routings_kind"),
    )
    op.create_index("idx_inbox_routings_created_at", "inbox_routings", ["created_at"])
    op.create_index("idx_inbox_routings_todo_id", "inbox_routings", ["todo_id"])
    op.create_index("idx_inbox_routings_note_id", "inbox_routings", ["note_id"])


def downgrade():
    op.drop_table("inbox_routings")
