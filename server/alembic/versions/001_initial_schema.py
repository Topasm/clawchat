"""Initial schema - create all tables.

Revision ID: 001
Revises: None
Create Date: 2025-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- conversations ----
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "is_archived", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_index(
        "idx_conversations_updated_at", "conversations", ["updated_at"]
    )

    # ---- messages ----
    op.create_table(
        "messages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "message_type", sa.String(), nullable=False, server_default="text"
        ),
        sa.Column("intent", sa.String(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
    )
    op.create_index(
        "idx_messages_conversation_id", "messages", ["conversation_id"]
    )
    op.create_index("idx_messages_created_at", "messages", ["created_at"])

    # ---- todos ----
    op.create_table(
        "todos",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status", sa.String(), nullable=False, server_default="pending"
        ),
        sa.Column(
            "priority", sa.String(), nullable=False, server_default="medium"
        ),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("conversations.id"),
            nullable=True,
        ),
        sa.Column(
            "message_id",
            sa.String(),
            sa.ForeignKey("messages.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("tags", sa.JSON(), nullable=True),
    )
    op.create_index("idx_todos_status", "todos", ["status"])
    op.create_index("idx_todos_due_date", "todos", ["due_date"])
    op.create_index("idx_todos_conversation_id", "todos", ["conversation_id"])

    # ---- events ----
    op.create_table(
        "events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column(
            "is_all_day", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("reminder_minutes", sa.Integer(), nullable=True),
        sa.Column("recurrence_rule", sa.String(), nullable=True),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("conversations.id"),
            nullable=True,
        ),
        sa.Column(
            "message_id",
            sa.String(),
            sa.ForeignKey("messages.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("tags", sa.JSON(), nullable=True),
    )
    op.create_index("idx_events_start_time", "events", ["start_time"])
    op.create_index("idx_events_end_time", "events", ["end_time"])
    op.create_index(
        "idx_events_conversation_id", "events", ["conversation_id"]
    )

    # ---- memos ----
    op.create_table(
        "memos",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("conversations.id"),
            nullable=True,
        ),
        sa.Column(
            "message_id",
            sa.String(),
            sa.ForeignKey("messages.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("tags", sa.JSON(), nullable=True),
    )
    op.create_index("idx_memos_conversation_id", "memos", ["conversation_id"])
    op.create_index("idx_memos_updated_at", "memos", ["updated_at"])

    # ---- agent_tasks ----
    op.create_table(
        "agent_tasks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("task_type", sa.String(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column(
            "status", sa.String(), nullable=False, server_default="queued"
        ),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("conversations.id"),
            nullable=True,
        ),
        sa.Column(
            "message_id",
            sa.String(),
            sa.ForeignKey("messages.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("idx_agent_tasks_status", "agent_tasks", ["status"])
    op.create_index(
        "idx_agent_tasks_conversation_id", "agent_tasks", ["conversation_id"]
    )


def downgrade() -> None:
    op.drop_table("agent_tasks")
    op.drop_table("memos")
    op.drop_table("events")
    op.drop_table("todos")
    op.drop_table("messages")
    op.drop_table("conversations")
