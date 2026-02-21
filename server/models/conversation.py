"""Conversation SQLAlchemy model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Index, JSON, String
from sqlalchemy.orm import relationship

from database import Base


class Conversation(Base):
    """Stores chat conversation metadata."""

    __tablename__ = "conversations"

    id = Column(String, primary_key=True, default=lambda: uuid4().hex)
    title = Column(String, nullable=False, default="")
    created_at = Column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    is_archived = Column(Boolean, nullable=False, default=False)
    metadata_ = Column("metadata", JSON, nullable=True)

    # Relationships
    messages = relationship("Message", back_populates="conversation")

    __table_args__ = (
        Index("idx_conversations_updated_at", "updated_at"),
    )
