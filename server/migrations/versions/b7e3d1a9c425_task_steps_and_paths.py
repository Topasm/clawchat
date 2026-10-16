"""Undo records for task steps, and paths attached to tasks.

Revision ID: b7e3d1a9c425
Revises: a4c9e2f7b310
"""

from alembic import op
import sqlalchemy as sa

revision = "b7e3d1a9c425"
down_revision = "a4c9e2f7b310"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("task_step_changes"):
        op.create_table(
            "task_step_changes",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("todo_id", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column(
                "created_todo_ids_json", sa.Text(), nullable=False, server_default="[]"
            ),
            sa.Column(
                "added_relationship_ids_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
            sa.Column(
                "removed_relationships_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
            sa.Column("sort_orders_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(), nullable=False, server_default="applied"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "kind IN ('add', 'move')", name="ck_task_step_changes_kind_valid"
            ),
            sa.CheckConstraint(
                "status IN ('applied', 'reverted')",
                name="ck_task_step_changes_status_valid",
            ),
        )
        op.create_index(
            "idx_task_step_changes_todo",
            "task_step_changes",
            ["todo_id", "created_at"],
        )
    if not inspector.has_table("todo_paths"):
        op.create_table(
            "todo_paths",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "todo_id",
                sa.String(),
                sa.ForeignKey("todos.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column(
                "host_id",
                sa.String(),
                sa.ForeignKey("execution_hosts.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("path", sa.Text(), nullable=False),
            sa.Column("label", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "kind IN ('device', 'vault', 'url')", name="ck_todo_paths_kind_valid"
            ),
        )
        op.create_index("idx_todo_paths_todo_id", "todo_paths", ["todo_id"])


def downgrade():
    op.drop_index("idx_todo_paths_todo_id", table_name="todo_paths")
    op.drop_table("todo_paths")
    op.drop_index("idx_task_step_changes_todo", table_name="task_step_changes")
    op.drop_table("task_step_changes")
