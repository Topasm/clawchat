"""Revision-bound AI suggestions for placing Inbox tasks."""

from pydantic import BaseModel, Field, field_validator, model_validator


class InboxTriagePreviewRequest(BaseModel):
    todo_ids: list[str] = Field(min_length=1, max_length=50)
    expected_graph_revision: int = Field(ge=0)

    @field_validator("todo_ids")
    @classmethod
    def _validate_todo_ids(cls, value: list[str]) -> list[str]:
        if any(not todo_id.strip() for todo_id in value):
            raise ValueError("todo_ids must contain non-empty task IDs")
        if len(value) != len(set(value)):
            raise ValueError("todo_ids must not contain duplicates")
        return value


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
