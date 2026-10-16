"""Inbox routings remember how sure the classifier was.

Revision ID: e3a7c5f19b28
Revises: d5b2e8a41f73
"""

from alembic import op
import sqlalchemy as sa

revision = "e3a7c5f19b28"
down_revision = "d5b2e8a41f73"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("inbox_routings")}
    if "kind_confidence" not in columns:
        with op.batch_alter_table("inbox_routings") as batch:
            batch.add_column(sa.Column("kind_confidence", sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table("inbox_routings") as batch:
        batch.drop_column("kind_confidence")
