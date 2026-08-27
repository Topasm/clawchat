from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class HostIdentity(Base):
    """Persistent cryptographic identity for pairing and relay handshakes."""

    __tablename__ = "host_identity"

    id: Mapped[str] = mapped_column(String, primary_key=True, default="primary")
    host_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    private_key: Mapped[str] = mapped_column(Text, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
