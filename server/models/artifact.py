"""Versioned project artifacts and reviewable revisions."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.review import ArtifactRevisionStatus, ArtifactType, check_sql
from utils import make_id


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("artifact_"))
    project_id: Mapped[str] = mapped_column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[str | None] = mapped_column(String, ForeignKey("todos.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    source: Mapped[str] = mapped_column(String, nullable=False, default="human", server_default="human")
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    @validates("type")
    def validate_type(self, _key, value):
        return ArtifactType(value).value

    __table_args__ = (
        CheckConstraint(check_sql("type", ArtifactType), name="ck_artifacts_type"),
        CheckConstraint("current_version >= 1", name="ck_artifacts_current_version"),
        Index("idx_artifacts_project_updated", "project_id", "updated_at"),
        Index("idx_artifacts_task", "task_id"),
    )


class ArtifactRevision(Base):
    __tablename__ = "artifact_revisions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("revision_"))
    artifact_id: Mapped[str] = mapped_column(String, ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    source: Mapped[str] = mapped_column(String, nullable=False, default="human", server_default="human")
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @validates("status")
    def validate_status(self, _key, value):
        return ArtifactRevisionStatus(value).value

    __table_args__ = (
        CheckConstraint(check_sql("status", ArtifactRevisionStatus), name="ck_artifact_revisions_status"),
        CheckConstraint("version >= 1", name="ck_artifact_revisions_version"),
        UniqueConstraint("artifact_id", "version", name="uq_artifact_revisions_version"),
        Index("idx_artifact_revisions_artifact_created", "artifact_id", "created_at"),
    )
