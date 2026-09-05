"""Revision-bound AI suggestions for placing Inbox tasks."""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

from schemas.common import TodoIdList


class InboxTriagePreviewRequest(BaseModel):
    todo_ids: TodoIdList = Field(min_length=1, max_length=50)
    expected_graph_revision: int = Field(ge=0)
    timezone: str = Field(default="UTC", max_length=100)

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use an IANA timezone") from exc
        return value


class InboxDeadlineSuggestion(BaseModel):
    task_id: str
    due_date: datetime
    local_date: date
    timezone: str
    source_text: str
    is_past: bool


class InboxTriageSuggestion(BaseModel):
    task_id: str
    project_id: str
    parent_id: str | None = None
    proposed_parent_key: str | None = Field(default=None, min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _validate_destination(self):
        if self.proposed_parent_key is not None and self.parent_id is not None:
            raise ValueError(
                "parent_id must be null when proposed_parent_key is supplied"
            )
        return self


class InboxTriageProposedWorkstream(BaseModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    project_id: str
    parent_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("title", "reason")
    @classmethod
    def _validate_nonblank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Workstream text must not be blank")
        return normalized


class InboxTriagePreviewResponse(BaseModel):
    base_graph_revision: int = Field(ge=0)
    suggestions: list[InboxTriageSuggestion]
    proposed_workstreams: list[InboxTriageProposedWorkstream] = Field(
        default_factory=list,
        max_length=10,
    )
    unassigned_task_ids: list[str]
    model_provider: str | None = None
    deadlines: list[InboxDeadlineSuggestion] = Field(default_factory=list)
