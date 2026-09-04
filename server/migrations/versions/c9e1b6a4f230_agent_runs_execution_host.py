"""record which registered machine a run belongs to

`agent_runs.host_id` holds the label a provider reported after the fact. Work
handed to a worker has to be addressed *before* it runs, which needs the host's
identity rather than its name.

Revision ID: c9e1b6a4f230
Revises: b2d7f4e91c58
Create Date: 2026-09-03 04:50:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9e1b6a4f230"
down_revision: Union[str, Sequence[str], None] = "b2d7f4e91c58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "execution_host_id" in {
        column["name"] for column in inspector.get_columns("agent_runs")
    }:
        return
    op.execute("ALTER TABLE agent_runs ADD COLUMN execution_host_id VARCHAR")
    op.create_index(
        "idx_agent_runs_execution_host_id",
        "agent_runs",
        ["execution_host_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_agent_runs_execution_host_id", table_name="agent_runs")
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # Batch mode rebuilds agent_runs, and rebuilding a table other rows
        # reference is what the earlier revisions take pains to avoid.
        op.execute("ALTER TABLE agent_runs DROP COLUMN execution_host_id")
    else:
        with op.batch_alter_table("agent_runs") as batch_op:
            batch_op.drop_column("execution_host_id")
