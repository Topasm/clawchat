"""de-duplicate retried mobile share captures

Revision ID: a8f3c1d7e240
Revises: 9b4c1d7e2f60
Create Date: 2026-08-31 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8f3c1d7e240"
down_revision: Union[str, Sequence[str], None] = "9b4c1d7e2f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A legacy database can be materialised by today's create_all before it is
    # adopted into Alembic. In that path both columns/indexes already exist,
    # so every operation must be independently idempotent.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table, index_name in (
        ("todos", "uq_todos_idempotency_key"),
        ("attachments", "uq_attachments_idempotency_key"),
    ):
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "idempotency_key" not in columns:
            op.add_column(
                table,
                sa.Column("idempotency_key", sa.String(length=64), nullable=True),
            )
        indexes = {index["name"] for index in sa.inspect(bind).get_indexes(table)}
        if index_name not in indexes:
            op.create_index(
                index_name,
                table,
                ["idempotency_key"],
                unique=True,
                sqlite_where=sa.text("idempotency_key IS NOT NULL"),
                postgresql_where=sa.text("idempotency_key IS NOT NULL"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    for table, index_name in (
        ("attachments", "uq_attachments_idempotency_key"),
        ("todos", "uq_todos_idempotency_key"),
    ):
        indexes = {index["name"] for index in sa.inspect(bind).get_indexes(table)}
        if index_name in indexes:
            op.drop_index(index_name, table_name=table)
        columns = {column["name"] for column in sa.inspect(bind).get_columns(table)}
        if "idempotency_key" in columns:
            op.drop_column(table, "idempotency_key")
