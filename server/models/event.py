from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("evt_"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reminder_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recurrence_rule: Mapped[str | None] = mapped_column(Text, nullable=True)
    recurrence_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recurrence_exceptions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of ISO dates
    recurring_event_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("events.id"), nullable=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("conversations.id"), nullable=True
    )
    message_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("messages.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    # --- Calendar sync (CalDAV) ---
    # "local": made in ClawChat (pushed to the write calendar when one is set).
    # "remote": imported from a connected calendar; read-only here.
    origin: Mapped[str] = mapped_column(String, nullable=False, default="local", server_default="local")
    # No database-level foreign key: adding one would mean rebuilding the
    # events table, which other tables reference. The sync service removes an
    # imported event together with its calendar.
    calendar_source_id: Mapped[str | None] = mapped_column(String, nullable=True)
    external_uid: Mapped[str | None] = mapped_column(Text, nullable=True)
    # For one occurrence of an imported series: that occurrence's original start.
    external_recurrence_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_href: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_etag: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_events_start_time", "start_time"),
        Index("idx_events_project_id", "project_id"),
        Index("idx_events_end_time", "end_time"),
        Index("idx_events_conversation_id", "conversation_id"),
        Index("idx_events_calendar_source_id", "calendar_source_id"),
    )
