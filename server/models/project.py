"""First-class project identity and project-local graph revision."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.project import (
    PROJECT_STATUS_CHECK_SQL,
    PROJECT_STATUS_VALUES,
    ProjectStatus,
)
from utils import make_id


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("project_"),
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=ProjectStatus.ACTIVE,
        server_default=ProjectStatus.ACTIVE.value,
    )
    deadline: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    root_task_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey(
            "todos.id",
            name="fk_projects_root_task_id",
            ondelete="SET NULL",
            use_alter=True,
        ),
        nullable=True,
    )
    graph_revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    default_execution_provider: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )
    default_execution_model: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )
    #: The machine this project's work runs on. Null keeps the historical
    #: behaviour: whichever machine the server itself runs on.
    #:
    #: Deliberately not a foreign key: SQLite cannot add one in place, and
    #: rebuilding ``projects`` to gain it would briefly drop the table and fire
    #: SET NULL cascades from every project-scoped row. Deleting a host clears
    #: the references through ``execution_host_service`` instead.
    execution_host_id: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )
    #: Compatibility shadow of the chosen host's path in ``project_host_paths``;
    #: no longer the read model.
    execution_workspace_path: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    execution_workspace_isolation: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="local",
        server_default="local",
    )
    execution_base_branch: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
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

    @validates("status")
    def _validate_status(self, _key: str, value: str | ProjectStatus) -> str:
        try:
            return ProjectStatus(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(PROJECT_STATUS_VALUES)
            raise ValueError(
                f"Invalid project status {value!r}; expected one of: {allowed}"
            ) from exc

    @validates("execution_workspace_isolation")
    def _validate_execution_workspace_isolation(self, _key: str, value: str) -> str:
        if value not in {"local", "worktree"}:
            raise ValueError("Execution workspace isolation must be local or worktree")
        return value

    __table_args__ = (
        CheckConstraint(PROJECT_STATUS_CHECK_SQL, name="ck_projects_status_valid"),
        CheckConstraint(
            "graph_revision >= 0",
            name="ck_projects_graph_revision_nonnegative",
        ),
        CheckConstraint(
            "execution_workspace_isolation IN ('local', 'worktree')",
            name="ck_projects_execution_workspace_isolation",
        ),
        Index("idx_projects_status", "status"),
        Index("idx_projects_updated_at", "updated_at"),
        Index("uq_projects_root_task_id", "root_task_id", unique=True),
    )
