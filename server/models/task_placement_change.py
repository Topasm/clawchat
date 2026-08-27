"""Durable undo boundary for one atomic task placement."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


class TaskPlacementChange(Base):
    __tablename__ = "task_placement_changes"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("placement_"),
    )
    todo_id: Mapped[str] = mapped_column(String, nullable=False)
    base_graph_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_graph_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    reverted_graph_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    before_json: Mapped[str] = mapped_column(Text, nullable=False)
    after_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="applied",
        server_default="applied",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    reverted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('applied', 'reverted')",
            name="ck_task_placement_changes_status_valid",
        ),
        CheckConstraint(
            "base_graph_revision >= 0 AND applied_graph_revision >= 0",
            name="ck_task_placement_changes_revisions_nonnegative",
        ),
        CheckConstraint(
            "reverted_graph_revision IS NULL OR reverted_graph_revision >= 0",
            name="ck_task_placement_changes_reverted_revision_nonnegative",
        ),
        Index("idx_task_placement_changes_todo", "todo_id", "created_at"),
        Index("idx_task_placement_changes_status", "status"),
    )
