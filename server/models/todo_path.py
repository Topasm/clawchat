"""Places a task's material lives: a folder on a machine, a vault note, a URL."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id

TODO_PATH_KINDS = ("device", "vault", "url")


class TodoPath(Base):
    """One path attached to a task.

    A device path means nothing without its machine, so it names the host it
    was entered on. Vault notes and URLs need no host.
    """

    __tablename__ = "todo_paths"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("path_"),
    )
    todo_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("todos.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    host_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("execution_hosts.id", ondelete="SET NULL"),
        nullable=True,
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('device', 'vault', 'url')",
            name="ck_todo_paths_kind_valid",
        ),
        Index("idx_todo_paths_todo_id", "todo_id"),
    )
