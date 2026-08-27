"""Contracts for the unified review inbox."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType


class ReviewDecisionRequest(BaseModel):
    decision: ReviewStatus
    note: str | None = Field(default=None, max_length=10_000)

    @model_validator(mode="after")
    def validate_decision(self):
        if self.decision not in {
            ReviewStatus.APPROVED,
            ReviewStatus.CHANGES_REQUESTED,
            ReviewStatus.REJECTED,
        }:
            raise ValueError("decision must approve, reject, or request changes")
        return self


class ReviewItemResponse(BaseModel):
    id: str
    project_id: str | None = None
    project_title: str | None = None
    subject_type: ReviewSubjectType
    subject_id: str
    subject_title: str | None = None
    subject_description: str | None = None
    subject_href: str | None = None
    status: ReviewStatus
    summary: str
    risk_level: ReviewRiskLevel
    requested_at: datetime
    reviewed_at: datetime | None = None
    review_note: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class ReviewDecisionResponse(BaseModel):
    review: ReviewItemResponse
    outcome: dict[str, Any] = Field(default_factory=dict)
