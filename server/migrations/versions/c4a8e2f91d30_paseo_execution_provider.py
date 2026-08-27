"""add Paseo execution-provider metadata

Revision ID: c4a8e2f91d30
Revises: b7e3a19d4c52
Create Date: 2026-08-28 01:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4a8e2f91d30"
down_revision: Union[str, Sequence[str], None] = "b7e3a19d4c52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # Rebuilding projects would temporarily drop the table and activate
        # SET NULL cascades from every project-scoped row. SQLite supports
        # these additive columns in place, preserving all links and triggers.
        op.execute("ALTER TABLE projects ADD COLUMN default_execution_model VARCHAR")
        op.execute("ALTER TABLE projects ADD COLUMN execution_workspace_path TEXT")
        op.execute(
            "ALTER TABLE projects ADD COLUMN "
            "execution_workspace_isolation VARCHAR NOT NULL DEFAULT 'local'"
        )
        op.execute("ALTER TABLE projects ADD COLUMN execution_base_branch VARCHAR")
        op.execute("ALTER TABLE agent_runs ADD COLUMN external_run_id VARCHAR")
        op.create_index(
            "idx_agent_runs_external_run_id",
            "agent_runs",
            ["external_run_id"],
        )
        return

    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column("default_execution_model", sa.String(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("execution_workspace_path", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "execution_workspace_isolation",
                sa.String(),
                server_default="local",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("execution_base_branch", sa.String(), nullable=True)
        )
        batch_op.create_check_constraint(
            "ck_projects_execution_workspace_isolation",
            "execution_workspace_isolation IN ('local', 'worktree')",
        )
    with op.batch_alter_table("agent_runs") as batch_op:
        batch_op.add_column(
            sa.Column("external_run_id", sa.String(), nullable=True)
        )
        batch_op.create_index(
            "idx_agent_runs_external_run_id", ["external_run_id"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.drop_index("idx_agent_runs_external_run_id", table_name="agent_runs")
        op.execute("ALTER TABLE agent_runs DROP COLUMN external_run_id")
        op.execute("ALTER TABLE projects DROP COLUMN execution_base_branch")
        op.execute("ALTER TABLE projects DROP COLUMN execution_workspace_isolation")
        op.execute("ALTER TABLE projects DROP COLUMN execution_workspace_path")
        op.execute("ALTER TABLE projects DROP COLUMN default_execution_model")
        return

    with op.batch_alter_table("agent_runs") as batch_op:
        batch_op.drop_index("idx_agent_runs_external_run_id")
        batch_op.drop_column("external_run_id")
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint("ck_projects_execution_workspace_isolation", type_="check")
        batch_op.drop_column("execution_base_branch")
        batch_op.drop_column("execution_workspace_isolation")
        batch_op.drop_column("execution_workspace_path")
        batch_op.drop_column("default_execution_model")
