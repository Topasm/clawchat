"""Secret iCal addresses as calendar accounts, and suggestions made from events.

Revision ID: a4c9e2f7b310
Revises: 5e0a7c3d9b14
"""

from alembic import op
import sqlalchemy as sa

revision = "a4c9e2f7b310"
down_revision = "5e0a7c3d9b14"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    accounts = {column["name"] for column in inspector.get_columns("calendar_accounts")}
    if "kind" not in accounts:
        op.execute("ALTER TABLE calendar_accounts ADD COLUMN kind VARCHAR NOT NULL DEFAULT 'caldav'")
    if "feed_url" not in accounts:
        op.execute("ALTER TABLE calendar_accounts ADD COLUMN feed_url TEXT")
    sources = {column["name"] for column in inspector.get_columns("calendar_sources")}
    if "suggestions_enabled" not in sources:
        op.execute(
            "ALTER TABLE calendar_sources ADD COLUMN suggestions_enabled BOOLEAN NOT NULL DEFAULT '1'"
        )
    if not inspector.has_table("event_suggestions"):
        op.create_table(
            "event_suggestions",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("subject_key", sa.Text(), nullable=False),
            sa.Column("occurrence_key", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("event_id", sa.String(), nullable=True),
            sa.Column("event_title", sa.Text(), nullable=True),
            sa.Column("event_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("block_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("block_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("todo_id", sa.String(), nullable=True),
            sa.Column("note_id", sa.String(), nullable=True),
            sa.Column("created_event_id", sa.String(), nullable=True),
            sa.Column("project_id", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("auto_added", sa.Boolean(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "kind", "subject_key", "occurrence_key", name="uq_event_suggestions_key"
            ),
        )
        op.create_index("ix_event_suggestions_status", "event_suggestions", ["status"])


def downgrade():
    op.drop_index("ix_event_suggestions_status", table_name="event_suggestions")
    op.drop_table("event_suggestions")
    with op.batch_alter_table("calendar_sources") as batch:
        batch.drop_column("suggestions_enabled")
    with op.batch_alter_table("calendar_accounts") as batch:
        batch.drop_column("feed_url")
        batch.drop_column("kind")
