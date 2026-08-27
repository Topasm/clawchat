"""Normalized edges between tasks."""

from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.task_relationship import (
    TASK_RELATIONSHIP_TYPE_CHECK_SQL,
    TASK_RELATIONSHIP_TYPE_VALUES,
    TaskRelationshipType,
)
from utils import make_id


class TaskRelationship(Base):
    """A directed, typed edge between two persisted tasks.

    For ``depends_on``, ``source_task_id`` is the task being executed and
    ``target_task_id`` is its prerequisite. The inverse ``blocks`` edge is
    derived when reading the graph and is never stored separately.
    """

    __tablename__ = "task_relationships"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("rel_"),
    )
    source_task_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("todos.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_task_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("todos.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="user",
        server_default="user",
    )
    proposal_id: Mapped[str | None] = mapped_column(String, nullable=True)
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

    @validates("type")
    def _validate_type(
        self,
        _key: str,
        value: str | TaskRelationshipType,
    ) -> str:
        """Reject unsupported edge types before they reach the database."""
        try:
            return TaskRelationshipType(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(TASK_RELATIONSHIP_TYPE_VALUES)
            raise ValueError(
                f"Invalid task relationship type {value!r}; expected one of: {allowed}"
            ) from exc

    @validates("source_task_id", "target_task_id")
    def _validate_task_ids(self, key: str, value: str) -> str:
        """Reject blank IDs before they reach FK and graph validation."""
        normalized = value.strip() if isinstance(value, str) else ""
        if not normalized:
            raise ValueError(f"{key} must not be blank")
        return normalized

    @validates("created_by")
    def _validate_created_by(self, _key: str, value: str) -> str:
        """Keep provenance present and canonical at the ORM boundary."""
        normalized = value.strip() if isinstance(value, str) else ""
        if not normalized:
            raise ValueError("created_by must not be blank")
        return normalized

    __table_args__ = (
        CheckConstraint(
            TASK_RELATIONSHIP_TYPE_CHECK_SQL,
            name="ck_task_relationships_type_valid",
        ),
        CheckConstraint(
            "source_task_id <> target_task_id",
            name="ck_task_relationships_not_self",
        ),
        UniqueConstraint(
            "source_task_id",
            "target_task_id",
            "type",
            name="uq_task_relationships_source_target_type",
        ),
        Index(
            "idx_task_relationships_source_type",
            "source_task_id",
            "type",
        ),
        Index(
            "idx_task_relationships_target_type",
            "target_task_id",
            "type",
        ),
        Index("idx_task_relationships_proposal_id", "proposal_id"),
    )
