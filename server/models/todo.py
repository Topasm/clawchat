"""Todo SQLAlchemy model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, JSON, String, Text

from database import Base


class Todo(Base):
    """Stores task / to-do items."""

    __tablename__ = "todos"

    id = Column(String, primary_key=True, default=lambda: uuid4().hex)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        String, nullable=False, default="pending"
    )  # pending / in_progress / completed / cancelled
    priority = Column(
        String, nullable=False, default="medium"
    )  # low / medium / high / urgent
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    conversation_id = Column(
        String, ForeignKey("conversations.id"), nullable=True
    )
    message_id = Column(String, ForeignKey("messages.id"), nullable=True)
    created_at = Column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    tags = Column(JSON, nullable=True)

    __table_args__ = (
        Index("idx_todos_status", "status"),
        Index("idx_todos_due_date", "due_date"),
        Index("idx_todos_conversation_id", "conversation_id"),
    )
