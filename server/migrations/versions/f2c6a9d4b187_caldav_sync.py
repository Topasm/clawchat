"""CalDAV calendar sync: accounts, calendars, pending pushes, and event links.

Revision ID: f2c6a9d4b187
Revises: c3e8f6a12b49
"""

from alembic import op
import sqlalchemy as sa

revision = "f2c6a9d4b187"
down_revision = "c3e8f6a12b49"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("calendar_accounts"):
        op.create_table(
            "calendar_accounts",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("label", sa.Text(), nullable=False),
            sa.Column("server_url", sa.Text(), nullable=False),
            sa.Column("username", sa.Text(), nullable=False),
            sa.Column("password", sa.Text(), nullable=False),
            sa.Column("home_url", sa.Text(), nullable=True),
            sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if not inspector.has_table("calendar_sources"):
        op.create_table(
            "calendar_sources",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "account_id",
                sa.String(),
                sa.ForeignKey("calendar_accounts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("href", sa.Text(), nullable=False),
            sa.Column("display_name", sa.Text(), nullable=False),
            sa.Column("color", sa.String(), nullable=True),
            sa.Column("import_enabled", sa.Boolean(), nullable=False),
            sa.Column("is_write_target", sa.Boolean(), nullable=False),
            sa.Column("ctag", sa.Text(), nullable=True),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_calendar_sources_account_id", "calendar_sources", ["account_id"])
    if not inspector.has_table("calendar_pushes"):
        op.create_table(
            "calendar_pushes",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "source_id",
                sa.String(),
                sa.ForeignKey("calendar_sources.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(),
                sa.ForeignKey("events.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("href", sa.Text(), nullable=True),
            sa.Column("etag", sa.Text(), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_calendar_pushes_source_id", "calendar_pushes", ["source_id"])

    # Plain ADD COLUMN: batch mode would rebuild events, which other tables
    # reference and older downgrades expect in its original shape.
    existing = {column["name"] for column in inspector.get_columns("events")}
    for name, ddl in (
        ("origin", "VARCHAR NOT NULL DEFAULT 'local'"),
        ("calendar_source_id", "VARCHAR"),
        ("external_uid", "TEXT"),
        ("external_recurrence_id", "TEXT"),
        ("external_href", "TEXT"),
        ("external_etag", "TEXT"),
    ):
        if name not in existing:
            op.execute(f"ALTER TABLE events ADD COLUMN {name} {ddl}")
    if "idx_events_calendar_source_id" not in {
        index["name"] for index in inspector.get_indexes("events")
    }:
        op.create_index("idx_events_calendar_source_id", "events", ["calendar_source_id"])


def downgrade():
    op.drop_index("idx_events_calendar_source_id", table_name="events")
    for name in (
        "external_etag",
        "external_href",
        "external_recurrence_id",
        "external_uid",
        "calendar_source_id",
        "origin",
    ):
        op.execute(f"ALTER TABLE events DROP COLUMN {name}")
    op.drop_table("calendar_pushes")
    op.drop_table("calendar_sources")
    op.drop_table("calendar_accounts")
