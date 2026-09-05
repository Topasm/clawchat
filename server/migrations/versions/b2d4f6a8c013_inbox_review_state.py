"""Persist Inbox review preferences and revision-bound previews."""

from alembic import op
import sqlalchemy as sa

revision = "b2d4f6a8c013"
down_revision = "d4f6a8b0c213"
branch_labels = None
depends_on = None


def upgrade():
    # Legacy startup can have already materialized these tables with create_all.
    if not sa.inspect(op.get_bind()).has_table("inbox_review_preferences"):
        op.create_table(
            "inbox_review_preferences",
            sa.Column("owner", sa.String(), primary_key=True),
            sa.Column(
                "task_id",
                sa.String(),
                sa.ForeignKey("todos.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("deferred", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column(
                "exclude_deadline", sa.Boolean(), nullable=False, server_default="0"
            ),
            sa.Column("choice_json", sa.Text(), nullable=True),
            sa.Column("choice_revision", sa.Integer(), nullable=True),
        )
    if not sa.inspect(op.get_bind()).has_table("inbox_preview_cache"):
        op.create_table(
            "inbox_preview_cache",
            sa.Column("owner", sa.String(), primary_key=True),
            sa.Column("cache_key", sa.String(), primary_key=True),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("payload", sa.Text(), nullable=False),
        )


def downgrade():
    op.drop_table("inbox_preview_cache")
    op.drop_table("inbox_review_preferences")
