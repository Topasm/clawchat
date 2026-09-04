"""folder context snapshot per project host path

The server never reads another machine's disk. What it can hold is what the
worker on that machine read and sent: a bounded snapshot of the folder's
README-like files, kept next to the path it describes so chat and execution
can see the workspace the way the machine sees it.

Revision ID: a1c3e5f7b902
Revises: e7c4a91d2b36
Create Date: 2026-09-05 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c3e5f7b902"
down_revision: Union[str, Sequence[str], None] = "e7c4a91d2b36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "project_host_paths"
_COLUMNS = (
    sa.Column("context_text", sa.Text(), nullable=True),
    sa.Column("context_files", sa.Text(), nullable=True),
    sa.Column("context_updated_at", sa.DateTime(timezone=True), nullable=True),
)


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns(_TABLE)}
    for column in _COLUMNS:
        if column.name not in existing:
            op.add_column(_TABLE, column)


def downgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns(_TABLE)}
    for column in reversed(_COLUMNS):
        if column.name in existing:
            op.drop_column(_TABLE, column.name)
