"""canonical task status

Revision ID: c5e936c9d7b1
Revises: 9927ab512428
Create Date: 2026-08-27 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c5e936c9d7b1"
down_revision: Union[str, Sequence[str], None] = "9927ab512428"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VALID_STATUS_SQL = "'pending', 'in_progress', 'completed', 'cancelled'"


def upgrade() -> None:
    # Preserve legacy databases that may contain an ad-hoc status before the
    # canonical enum was introduced. Known values retain their exact strings.
    op.execute(
        sa.text(
            f"UPDATE todos SET status = 'pending', completed_at = NULL "
            f"WHERE status IS NULL OR status NOT IN ({_VALID_STATUS_SQL})"
        )
    )
    with op.batch_alter_table("todos", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_todos_status_valid",
            f"status IN ({_VALID_STATUS_SQL})",
        )


def downgrade() -> None:
    with op.batch_alter_table("todos", schema=None) as batch_op:
        batch_op.drop_constraint("ck_todos_status_valid", type_="check")
