from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CalendarAccount(Base):
    """A CalDAV account (iCloud, Nextcloud, Fastmail, ...) the user connected."""

    __tablename__ = "calendar_accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("calacct_"))
    label: Mapped[str] = mapped_column(Text, nullable=False)
    server_url: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    # An app-specific password; the API never returns it.
    password: Mapped[str] = mapped_column(Text, nullable=False)
    home_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class CalendarSource(Base):
    """One remote calendar of an account."""

    __tablename__ = "calendar_sources"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("calsrc_"))
    account_id: Mapped[str] = mapped_column(
        String, ForeignKey("calendar_accounts.id", ondelete="CASCADE"), nullable=False
    )
    href: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    # Show its events and count them as busy time.
    import_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Where events created in ClawChat are saved (at most one calendar).
    is_write_target: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ctag: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)

    __table_args__ = (Index("ix_calendar_sources_account_id", "account_id"),)


class CalendarPush(Base):
    """A change to a ClawChat event that still has to reach the write calendar."""

    __tablename__ = "calendar_pushes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("calpush_"))
    source_id: Mapped[str] = mapped_column(
        String, ForeignKey("calendar_sources.id", ondelete="CASCADE"), nullable=False
    )
    # Null for a deletion: the event row is gone, the href and etag remain.
    event_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String, nullable=False)  # "put" | "delete"
    href: Mapped[str | None] = mapped_column(Text, nullable=True)
    etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)

    __table_args__ = (Index("ix_calendar_pushes_source_id", "source_id"),)
