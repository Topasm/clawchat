"""Where the Inbox sent a capture, and what it looked like before.

Every move between the Inbox, a task and a note leaves one row: ``origin``
says whether the server or the user made it, so the share of captures that
needed a hand is measurable, and ``before_json`` holds enough to put the item
back exactly as it was.
"""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Float, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


class InboxRouting(Base):
    __tablename__ = "inbox_routings"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: make_id("route_")
    )
    origin: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    # No foreign keys: the row outlives the item it moved, which a later move
    # or undo may delete and recreate under the same id.
    todo_id: Mapped[str | None] = mapped_column(String, nullable=True)
    note_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    original_title: Mapped[str] = mapped_column(Text, nullable=False)
    due_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    project_folder: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The classifier's certainty when it chose the kind; null when a rule or
    # the user did. Low values are filed anyway and only marked on the row.
    kind_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    before_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reverted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint("origin IN ('auto', 'user')", name="ck_inbox_routings_origin"),
        CheckConstraint("kind IN ('task', 'note')", name="ck_inbox_routings_kind"),
        Index("idx_inbox_routings_created_at", "created_at"),
        Index("idx_inbox_routings_todo_id", "todo_id"),
        Index("idx_inbox_routings_note_id", "note_id"),
    )
