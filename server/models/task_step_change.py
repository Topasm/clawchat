"""Undo boundary for adding or moving one step in a task's flow."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id


class TaskStepChange(Base):
    """What one step command created, removed and renumbered under a task.

    Adding a step creates a child task and its ``depends_on`` edges; moving one
    rewires sibling edges and sort order. Both are recorded here so a single
    undo puts the flow back, restoring removed edges with their original IDs.
    """

    __tablename__ = "task_step_changes"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("steps_"),
    )
    #: The task whose direct children are the steps.
    todo_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    created_todo_ids_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default="[]"
    )
    added_relationship_ids_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default="[]"
    )
    removed_relationships_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default="[]"
    )
    #: ``{todo_id: [before, after]}`` for sort orders the command changed.
    sort_orders_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="{}", server_default="{}"
    )
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
            "kind IN ('add', 'move')",
            name="ck_task_step_changes_kind_valid",
        ),
        CheckConstraint(
            "status IN ('applied', 'reverted')",
            name="ck_task_step_changes_status_valid",
        ),
        Index("idx_task_step_changes_todo", "todo_id", "created_at"),
    )
