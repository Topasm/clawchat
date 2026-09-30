from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


class ScheduledJob(Base):
    """A standing instruction the server runs on a schedule.

    Each firing becomes an ordinary agent task and run, so its result goes
    through review and is posted to the job's own thread like any other run.
    """

    __tablename__ = "scheduled_jobs"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: make_id("sjob_")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    skill_chain: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    project_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    include_task_snapshot: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    # An RRULE (no DTSTART) whose wall-clock times are read in ``timezone``.
    rrule: Mapped[str] = mapped_column(Text, nullable=False)
    timezone: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # None while the job is disabled or its rule has no further occurrences.
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_run_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_scheduled_jobs_due", "enabled", "next_run_at"),
        Index("ix_scheduled_jobs_project_id", "project_id"),
    )
