import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class PairedDevice(Base):
    __tablename__ = "paired_devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "iPhone 15", "iPad"
    device_type: Mapped[str] = mapped_column(String, nullable=False)  # "ios", "android", "web"
    device_token: Mapped[str] = mapped_column(String, unique=True, nullable=False)  # JWT for this device
    paired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    push_token: Mapped[str | None] = mapped_column(Text, nullable=True)  # for push notifications later

    __table_args__ = (
        Index("idx_paired_devices_is_active", "is_active"),
    )


class PairingSession(Base):
    __tablename__ = "pairing_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False)  # 6-digit pairing code
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )  # short-lived, e.g. 5 minutes
    claimed_by_device_id: Mapped[str | None] = mapped_column(String, nullable=True)  # set when pairing completes
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
