"""Memo SQLAlchemy model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, JSON, String, Text

from database import Base


class Memo(Base):
    """Stores notes and text snippets."""

    __tablename__ = "memos"

    id = Column(String, primary_key=True, default=lambda: uuid4().hex)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
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
        Index("idx_memos_conversation_id", "conversation_id"),
        Index("idx_memos_updated_at", "updated_at"),
    )
