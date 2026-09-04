"""User-authored comment threads on a task."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from utils import make_id


class TaskComment(Base):
    """One entry in the comment thread for a todo.

    Threads are flat (no reply-to nesting) and ordered by ``created_at``,
    mirroring how ``AgentRunEvent`` orders a run's execution log. Anchored by
    a stable ``id``/``todo_id`` so a later feature can reference a comment
    (e.g. to spin off a follow-up task or a graph edge) without rework.
    """

    __tablename__ = "task_comments"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("cmt_"),
    )
    todo_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("todos.id", ondelete="CASCADE"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="user",
        server_default="user",
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

    @validates("content")
    def _validate_content(self, _key: str, value: str) -> str:
        """Reject blank comments before they reach the database."""
        normalized = value.strip() if isinstance(value, str) else ""
        if not normalized:
            raise ValueError("content must not be blank")
        return normalized

    @validates("todo_id")
    def _validate_todo_id(self, _key: str, value: str) -> str:
        normalized = value.strip() if isinstance(value, str) else ""
        if not normalized:
            raise ValueError("todo_id must not be blank")
        return normalized

    @validates("created_by")
    def _validate_created_by(self, _key: str, value: str) -> str:
        normalized = value.strip() if isinstance(value, str) else ""
        if not normalized:
            raise ValueError("created_by must not be blank")
        return normalized

    __table_args__ = (
        Index("idx_task_comments_todo_id_created_at", "todo_id", "created_at"),
    )
