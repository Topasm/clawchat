"""task comments

Adoption note -- why this revision checks before it creates
-----------------------------------------------------------
This lands after ``database._LEGACY_REVISION_PROBES`` deliberately stops
adding entries (see the comment on that tuple), so an adopted pre-Alembic
database is stamped no higher than ``e2b7c4d81a35`` and then upgraded through
this revision like every other post-cutoff table. ``tests/test_legacy_startup_migration.py``
simulates that database with today's ``Base.metadata.create_all``, which
already declares ``task_comments``, so a plain ``op.create_table`` would
collide there. The upgrade is idempotent instead, following the pattern set by
``d1e94a7c3f28`` (calendar_feed_tokens): the table is created here in exactly
the shape the ORM declares, so an already-present table is by construction the
right one.

Revision ID: f4a9d3e6b812
Revises: c9e1b6a4f230
Create Date: 2026-09-04 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f4a9d3e6b812"
down_revision: Union[str, Sequence[str], None] = "c9e1b6a4f230"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "task_comments"


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table(_TABLE):
        # Already materialised by a create_all that ran ahead of the stamp.
        return
    op.create_table(
        "task_comments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("todo_id", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_by",
            sa.String(),
            server_default="user",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["todo_id"],
            ["todos.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_task_comments_todo_id_created_at",
        "task_comments",
        ["todo_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table(_TABLE):
        return
    op.drop_index(
        "idx_task_comments_todo_id_created_at",
        table_name="task_comments",
    )
    op.drop_table("task_comments")
