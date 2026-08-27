import uuid
from datetime import datetime, timezone

from database import Base
from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column


class RefreshSession(Base):
    """Server-side state for a rotating refresh-token family.

    Only a SHA-256 hash of the current random JWT ID is persisted. The refresh
    token and its raw JWT ID never reach the database.
    """

    __tablename__ = "refresh_sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    current_jti_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revocation_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("idx_refresh_sessions_subject", "subject"),
        Index("idx_refresh_sessions_expires_at", "expires_at"),
    )
