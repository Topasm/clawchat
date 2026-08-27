"""add atomic task placement change sets

Revision ID: d6f8a1c3e520
Revises: c4a8e2f91d30
Create Date: 2026-08-27 23:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6f8a1c3e520"
down_revision: Union[str, Sequence[str], None] = "c4a8e2f91d30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "task_placement_changes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("todo_id", sa.String(), nullable=False),
        sa.Column("base_graph_revision", sa.Integer(), nullable=False),
        sa.Column("applied_graph_revision", sa.Integer(), nullable=False),
        sa.Column("reverted_graph_revision", sa.Integer(), nullable=True),
        sa.Column("before_json", sa.Text(), nullable=False),
        sa.Column("after_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), server_default="applied", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('applied', 'reverted')",
            name="ck_task_placement_changes_status_valid",
        ),
        sa.CheckConstraint(
            "base_graph_revision >= 0 AND applied_graph_revision >= 0",
            name="ck_task_placement_changes_revisions_nonnegative",
        ),
        sa.CheckConstraint(
            "reverted_graph_revision IS NULL OR reverted_graph_revision >= 0",
            name="ck_task_placement_changes_reverted_revision_nonnegative",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_task_placement_changes_todo",
        "task_placement_changes",
        ["todo_id", "created_at"],
    )
    op.create_index(
        "idx_task_placement_changes_status",
        "task_placement_changes",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("idx_task_placement_changes_status", table_name="task_placement_changes")
    op.drop_index("idx_task_placement_changes_todo", table_name="task_placement_changes")
    op.drop_table("task_placement_changes")
