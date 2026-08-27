from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.task import TASK_STATUS_CHECK_SQL, TASK_STATUS_VALUES, TaskStatus
from utils import make_id


class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("todo_"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=TaskStatus.PENDING,
    )
    priority: Mapped[str] = mapped_column(String, nullable=False, default="medium")
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("conversations.id"), nullable=True
    )
    message_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("messages.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    parent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("todos.id", ondelete="SET NULL"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    source_id: Mapped[str | None] = mapped_column(String, nullable=True)
    assignee: Mapped[str | None] = mapped_column(String, nullable=True)
    enabled_skills: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    inbox_state: Mapped[str] = mapped_column(String, nullable=False, default="none")
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    automation_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    clarification_questions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of strings
    clarification_answers: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON object {index: answer}
    # Deprecated JSON compatibility shadow. Normalized task relationships are canonical.
    depends_on: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Recurrence fields (mirrors event recurrence pattern)
    recurrence_rule: Mapped[str | None] = mapped_column(Text, nullable=True)  # RRULE string
    recurrence_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recurrence_exceptions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of ISO dates
    recurring_source_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("todos.id", ondelete="SET NULL"), nullable=True
    )  # links occurrences back to the series

    @validates("status")
    def _validate_status(self, _key: str, value: str | TaskStatus) -> str:
        """Reject invalid states before they reach the database."""
        try:
            return TaskStatus(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(TASK_STATUS_VALUES)
            raise ValueError(
                f"Invalid task status {value!r}; expected one of: {allowed}"
            ) from exc

    __table_args__ = (
        CheckConstraint(
            TASK_STATUS_CHECK_SQL,
            name="ck_todos_status_valid",
        ),
        Index("idx_todos_status", "status"),
        Index("idx_todos_project_id", "project_id"),
        Index("idx_todos_due_date", "due_date"),
        Index("idx_todos_conversation_id", "conversation_id"),
        Index("idx_todos_parent_id", "parent_id"),
        Index("idx_todos_sort_order", "sort_order"),
        Index("idx_todos_source", "source"),
        Index("idx_todos_recurrence_rule", "recurrence_rule"),
    )
