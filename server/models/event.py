"""Event (calendar) SQLAlchemy model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)

from database import Base


class Event(Base):
    """Stores calendar events."""

    __tablename__ = "events"

    id = Column(String, primary_key=True, default=lambda: uuid4().hex)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    location = Column(String, nullable=True)
    is_all_day = Column(Boolean, nullable=False, default=False)
    reminder_minutes = Column(Integer, nullable=True)
    recurrence_rule = Column(String, nullable=True)
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
        Index("idx_events_start_time", "start_time"),
        Index("idx_events_end_time", "end_time"),
        Index("idx_events_conversation_id", "conversation_id"),
    )
