from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EventSuggestion(Base):
    """Something an upcoming calendar event, or a free stretch of time, calls for.

    One row per (kind, subject, occurrence), whatever happened to it, so a
    suggestion that was added or dismissed is never made again.
    """

    __tablename__ = "event_suggestions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("evsug_"))
    # prepare_exam | submit | prepare_talk | prepare_meeting | meeting_notes
    # | link_project | time_block
    kind: Mapped[str] = mapped_column(String, nullable=False)
    # The event's UID, or "todo:<id>" for a time block.
    subject_key: Mapped[str] = mapped_column(Text, nullable=False)
    # The occurrence of a series ("" for a single event); a time block's number.
    occurrence_key: Mapped[str] = mapped_column(Text, nullable=False, default="")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # The occurrence's ClawChat event, while it exists.
    event_id: Mapped[str | None] = mapped_column(String, nullable=True)
    event_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    block_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    block_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A time block's task; for the other kinds, the task adding it made.
    todo_id: Mapped[str | None] = mapped_column(String, nullable=True)
    note_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_event_id: Mapped[str | None] = mapped_column(String, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # pending | accepted | dismissed
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    # Added without asking, because the rule is sure enough.
    auto_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)

    __table_args__ = (
        UniqueConstraint("kind", "subject_key", "occurrence_key", name="uq_event_suggestions_key"),
        Index("ix_event_suggestions_status", "status"),
    )
