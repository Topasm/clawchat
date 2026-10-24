"""Inbox routings may file a capture as a calendar event.

Revision ID: d4e8a1b7c952
Revises: c9f4e2a7b513
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e8a1b7c952"
down_revision = "c9f4e2a7b513"
branch_labels = None
depends_on = None

_KINDS = "kind IN ('task', 'note', 'event')"


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("inbox_routings"):
        return
    columns = {column["name"] for column in inspector.get_columns("inbox_routings")}
    if "event_id" in columns:
        return
    # SQLite rebuilds the table to change a CHECK constraint; the batch keeps
    # every row and index.
    with op.batch_alter_table("inbox_routings", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("event_id", sa.String(), nullable=True))
        batch_op.drop_constraint("ck_inbox_routings_kind", type_="check")
        batch_op.create_check_constraint("ck_inbox_routings_kind", _KINDS)
    op.create_index("idx_inbox_routings_event_id", "inbox_routings", ["event_id"])


def downgrade():
    op.drop_index("idx_inbox_routings_event_id", table_name="inbox_routings")
    with op.batch_alter_table("inbox_routings", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_inbox_routings_kind", type_="check")
        batch_op.create_check_constraint(
            "ck_inbox_routings_kind", "kind IN ('task', 'note')"
        )
        batch_op.drop_column("event_id")
