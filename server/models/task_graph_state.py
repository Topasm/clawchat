"""Persisted optimistic-concurrency state for the task graph."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID


class TaskGraphState(Base):
    """Monotonic revision for a graph scope.

    PR3 initially uses one global scope. Keeping the scope as a primary key
    allows a later project model to introduce project-local revisions without
    changing the proposal and change-set contracts.
    """

    __tablename__ = "task_graph_states"

    scope_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=GLOBAL_TASK_GRAPH_SCOPE_ID,
    )
    revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "revision >= 0",
            name="ck_task_graph_states_revision_nonnegative",
        ),
    )
