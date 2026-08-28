"""de-duplicate retried chat sends with an idempotency key

Revision ID: e2b7c4d81a35
Revises: d6f8a1c3e520
Create Date: 2026-08-28 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2b7c4d81a35"
down_revision: Union[str, Sequence[str], None] = "d6f8a1c3e520"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("idempotency_key", sa.String(), nullable=True))
    # Partial index: only keyed messages are constrained, so the many historical
    # rows with a NULL key do not collide with each other.
    op.create_index(
        "uq_messages_conversation_idempotency_key",
        "messages",
        ["conversation_id", "idempotency_key"],
        unique=True,
        sqlite_where=sa.text("idempotency_key IS NOT NULL"),
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_messages_conversation_idempotency_key", table_name="messages")
    op.drop_column("messages", "idempotency_key")
