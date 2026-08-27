"""Transactional outbox jobs for eventual Obsidian vault reconciliation."""

from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.plan_proposal import (
    VAULT_SYNC_JOB_STATUS_CHECK_SQL,
    VAULT_SYNC_JOB_STATUS_VALUES,
    VaultSyncJobStatus,
)
from utils import make_id


class VaultSyncJob(Base):
    """At-least-once, idempotently keyed vault reconciliation request."""

    __tablename__ = "vault_sync_jobs"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("vault_job_"),
    )
    change_set_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("change_sets.id", ondelete="SET NULL"),
        nullable=True,
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String, nullable=False)
    payload_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="{}",
        server_default="{}",
    )
    dedupe_key: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=VaultSyncJobStatus.PENDING,
        server_default=VaultSyncJobStatus.PENDING.value,
    )
    attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    locked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    @validates("status")
    def _validate_status(
        self,
        _key: str,
        value: str | VaultSyncJobStatus,
    ) -> str:
        try:
            return VaultSyncJobStatus(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(VAULT_SYNC_JOB_STATUS_VALUES)
            raise ValueError(
                f"Invalid vault sync status {value!r}; expected one of: {allowed}"
            ) from exc

    __table_args__ = (
        CheckConstraint(
            VAULT_SYNC_JOB_STATUS_CHECK_SQL,
            name="ck_vault_sync_jobs_status_valid",
        ),
        CheckConstraint(
            "attempts >= 0",
            name="ck_vault_sync_jobs_attempts_nonnegative",
        ),
        UniqueConstraint("dedupe_key", name="uq_vault_sync_jobs_dedupe_key"),
        Index(
            "idx_vault_sync_jobs_delivery",
            "status",
            "available_at",
        ),
        Index("idx_vault_sync_jobs_change_set_id", "change_set_id"),
    )
