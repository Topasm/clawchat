"""Versioned AI plan proposals."""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.plan_proposal import (
    PLAN_PROPOSAL_STATUS_CHECK_SQL,
    PLAN_PROPOSAL_STATUS_VALUES,
    PlanProposalStatus,
)
from utils import make_id


class PlanProposal(Base):
    """Validated proposal tied to the graph revision it was generated from."""

    __tablename__ = "plan_proposals"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("proposal_"),
    )
    root_task_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("todos.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    agent_task_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("agent_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )
    base_graph_revision: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    model_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String, nullable=True)
    context_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    validation_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=PlanProposalStatus.GENERATING,
        server_default=PlanProposalStatus.GENERATING.value,
    )
    is_revertible: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=true(),
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

    @validates("status")
    def _validate_status(
        self,
        _key: str,
        value: str | PlanProposalStatus,
    ) -> str:
        try:
            return PlanProposalStatus(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(PLAN_PROPOSAL_STATUS_VALUES)
            raise ValueError(
                f"Invalid plan proposal status {value!r}; expected one of: {allowed}"
            ) from exc

    __table_args__ = (
        CheckConstraint(
            PLAN_PROPOSAL_STATUS_CHECK_SQL,
            name="ck_plan_proposals_status_valid",
        ),
        CheckConstraint(
            "base_graph_revision IS NULL OR base_graph_revision >= 0",
            name="ck_plan_proposals_base_revision_nonnegative",
        ),
        UniqueConstraint(
            "agent_task_id",
            name="uq_plan_proposals_agent_task_id",
        ),
        Index("idx_plan_proposals_root_status", "root_task_id", "status"),
        Index("idx_plan_proposals_project_status", "project_id", "status"),
        Index("idx_plan_proposals_created_at", "created_at"),
    )
