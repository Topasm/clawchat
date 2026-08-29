import uuid
from datetime import datetime, timezone

from database import Base
from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column


class CalendarFeedToken(Base):
    """Server-side state for a read-only iCalendar subscription URL.

    External calendar clients (Google Calendar, Apple Calendar, Thunderbird)
    cannot attach an ``Authorization`` header to a subscribed feed, so the only
    credential a subscription can carry is the URL itself. That credential is a
    high-entropy opaque string -- deliberately *not* a JWT, so it cannot decode
    anywhere in the bearer authentication path -- and, exactly like
    :class:`~models.refresh_session.RefreshSession`, only its SHA-256 hash is
    persisted. The value handed to the user is shown once, at issue time, and
    is unrecoverable afterwards.

    Rows are never deleted. Revocation stamps ``revoked_at`` instead, so the
    history of which feed was live when survives a reissue.
    """

    __tablename__ = "calendar_feed_tokens"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revocation_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("idx_calendar_feed_tokens_subject", "subject"),
        Index("idx_calendar_feed_tokens_token_hash", "token_hash", unique=True),
    )
