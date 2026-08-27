"""Unified human review queue item."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType, check_sql
from utils import make_id


class ReviewItem(Base):
    __tablename__ = "review_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("review_"))
    project_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    subject_type: Mapped[str] = mapped_column(String, nullable=False)
    subject_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default=ReviewStatus.PENDING, server_default=ReviewStatus.PENDING.value
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    risk_level: Mapped[str] = mapped_column(
        String, nullable=False, default=ReviewRiskLevel.MEDIUM, server_default=ReviewRiskLevel.MEDIUM.value
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    @validates("subject_type")
    def validate_subject_type(self, _key, value):
        return ReviewSubjectType(value).value

    @validates("status")
    def validate_status(self, _key, value):
        return ReviewStatus(value).value

    @validates("risk_level")
    def validate_risk(self, _key, value):
        return ReviewRiskLevel(value).value

    __table_args__ = (
        CheckConstraint(check_sql("subject_type", ReviewSubjectType), name="ck_review_items_subject_type"),
        CheckConstraint(check_sql("status", ReviewStatus), name="ck_review_items_status"),
        CheckConstraint(check_sql("risk_level", ReviewRiskLevel), name="ck_review_items_risk"),
        UniqueConstraint("subject_type", "subject_id", name="uq_review_items_subject"),
        Index("idx_review_items_status_requested", "status", "requested_at"),
        Index("idx_review_items_project_status", "project_id", "status"),
    )
