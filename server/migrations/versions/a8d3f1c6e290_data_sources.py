"""Device data sources: folders a machine offers for reading, their light
index, and the record of every request for them.

Revision ID: a8d3f1c6e290
Revises: f2c6a9d4b187
"""

from alembic import op
import sqlalchemy as sa

revision = "a8d3f1c6e290"
down_revision = "f2c6a9d4b187"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("data_sources"):
        op.create_table(
            "data_sources",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "host_id",
                sa.String(),
                sa.ForeignKey("execution_hosts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("capabilities", sa.Text(), nullable=False),
            sa.Column("include_folders", sa.Text(), nullable=False),
            sa.Column("exclude_folders", sa.Text(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("index_updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "kind IN ('obsidian_vault', 'folder')",
                name="ck_data_sources_kind_valid",
            ),
            sa.UniqueConstraint("host_id", "name", name="uq_data_sources_host_name"),
        )
        op.create_index("idx_data_sources_host_id", "data_sources", ["host_id"])
    if not inspector.has_table("data_source_entries"):
        op.create_table(
            "data_source_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "source_id",
                sa.String(),
                sa.ForeignKey("data_sources.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("path", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("modified_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint(
                "source_id", "path", name="uq_data_source_entries_source_path"
            ),
        )
    if not inspector.has_table("data_source_queries"):
        op.create_table(
            "data_source_queries",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "source_id",
                sa.String(),
                sa.ForeignKey("data_sources.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("host_id", sa.String(), nullable=False),
            sa.Column("op", sa.String(), nullable=False),
            sa.Column("path", sa.Text(), nullable=True),
            sa.Column("query", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("requested_by", sa.Text(), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("result", sa.Text(), nullable=True),
            sa.Column("result_bytes", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('queued', 'claimed', 'done', 'failed', 'denied', 'expired')",
                name="ck_data_source_queries_status_valid",
            ),
            sa.CheckConstraint(
                "op IN ('list', 'read', 'search')",
                name="ck_data_source_queries_op_valid",
            ),
        )
        op.create_index(
            "idx_data_source_queries_host_status",
            "data_source_queries",
            ["host_id", "status", "created_at"],
        )
        op.create_index(
            "idx_data_source_queries_source_created",
            "data_source_queries",
            ["source_id", "created_at"],
        )


def downgrade():
    for table in ("data_source_queries", "data_source_entries", "data_sources"):
        if sa.inspect(op.get_bind()).has_table(table):
            op.drop_table(table)
