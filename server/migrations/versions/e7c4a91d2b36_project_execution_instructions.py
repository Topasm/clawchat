"""add project execution instructions

Revision ID: e7c4a91d2b36
Revises: f4a9d3e6b812
Create Date: 2026-09-04 18:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7c4a91d2b36"
down_revision: Union[str, Sequence[str], None] = "f4a9d3e6b812"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "execution_instructions" not in columns:
        op.add_column(
            "projects",
            sa.Column("execution_instructions", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "execution_instructions" in columns:
        op.drop_column("projects", "execution_instructions")
