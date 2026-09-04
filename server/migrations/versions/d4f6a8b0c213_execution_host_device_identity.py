"""give desktop workers a stable machine identity

Revision ID: d4f6a8b0c213
Revises: a1c3e5f7b902
Create Date: 2026-09-04 22:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4f6a8b0c213"
down_revision: Union[str, Sequence[str], None] = "a1c3e5f7b902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "execution_hosts"
_INDEX = "uq_execution_hosts_device_id"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns(_TABLE)}
    if "device_id" not in columns:
        op.add_column(_TABLE, sa.Column("device_id", sa.Text(), nullable=True))

    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes(_TABLE)}
    if _INDEX not in indexes:
        op.create_index(_INDEX, _TABLE, ["device_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes(_TABLE)}
    if _INDEX in indexes:
        op.drop_index(_INDEX, table_name=_TABLE)
    columns = {column["name"] for column in sa.inspect(bind).get_columns(_TABLE)}
    if "device_id" in columns:
        op.drop_column(_TABLE, "device_id")
