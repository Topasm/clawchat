"""Durable forward and inverse operations for one proposal application."""

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
    CHANGE_SET_STATUS_CHECK_SQL,
    CHANGE_SET_STATUS_VALUES,
    ChangeSetStatus,
)
from utils import make_id


class ChangeSet(Base):
    """Idempotency claim, audit record, and undo boundary for an apply."""

    __tablename__ = "change_sets"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("changeset_"),
    )
    proposal_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("plan_proposals.id", ondelete="RESTRICT"),
        nullable=False,
    )
    request_hash: Mapped[str] = mapped_column(String, nullable=False)
    base_graph_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_graph_revision: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    reverted_graph_revision: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    operations_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="[]",
        server_default="[]",
    )
    inverse_operations_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="[]",
        server_default="[]",
    )
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    undo_response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=ChangeSetStatus.APPLYING,
        server_default=ChangeSetStatus.APPLYING.value,
    )
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
    applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    reverted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    @validates("status")
    def _validate_status(
        self,
        _key: str,
        value: str | ChangeSetStatus,
    ) -> str:
        try:
            return ChangeSetStatus(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(CHANGE_SET_STATUS_VALUES)
            raise ValueError(
                f"Invalid change-set status {value!r}; expected one of: {allowed}"
            ) from exc

    __table_args__ = (
        CheckConstraint(
            CHANGE_SET_STATUS_CHECK_SQL,
            name="ck_change_sets_status_valid",
        ),
        CheckConstraint(
            "base_graph_revision >= 0",
            name="ck_change_sets_base_revision_nonnegative",
        ),
        CheckConstraint(
            "applied_graph_revision IS NULL OR applied_graph_revision >= 0",
            name="ck_change_sets_applied_revision_nonnegative",
        ),
        CheckConstraint(
            "reverted_graph_revision IS NULL OR reverted_graph_revision >= 0",
            name="ck_change_sets_reverted_revision_nonnegative",
        ),
        UniqueConstraint("proposal_id", name="uq_change_sets_proposal_id"),
        Index("idx_change_sets_status", "status"),
    )
