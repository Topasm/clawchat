"""Message SQLAlchemy model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import relationship

from database import Base


class Message(Base):
    """Stores individual messages within conversations."""

    __tablename__ = "messages"

    id = Column(String, primary_key=True, default=lambda: uuid4().hex)
    conversation_id = Column(
        String, ForeignKey("conversations.id"), nullable=False
    )
    role = Column(String, nullable=False)  # user / assistant / system
    content = Column(Text, nullable=False)
    message_type = Column(String, nullable=False, default="text")
    intent = Column(String, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")

    __table_args__ = (
        Index("idx_messages_conversation_id", "conversation_id"),
        Index("idx_messages_created_at", "created_at"),
    )
