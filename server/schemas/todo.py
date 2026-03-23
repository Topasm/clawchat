import json
from datetime import datetime

from pydantic import BaseModel, field_validator


class TodoCreate(BaseModel):
    title: str
    description: str | None = None
    priority: str = "medium"
    due_date: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int | None = None
    source: str | None = None
    source_id: str | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str = "none"
    estimated_minutes: int | None = None
    depends_on: list[str] | None = None
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None


class TodoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    due_date: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str | None = None
    estimated_minutes: int | None = None
    depends_on: list[str] | None = None
    source: str | None = None
    source_id: str | None = None
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None


class AnswerQuestionsRequest(BaseModel):
    """Request body for POST /todos/{id}/answer-questions."""
    answers: dict[str, str]  # maps question index (as string) to answer text


class ProjectTodoResponse(BaseModel):
    """Extended todo response used for the project list endpoint."""
    id: str
    title: str
    description: str | None = None
    status: str
    priority: str
    due_date: datetime | None = None
    completed_at: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int = 0
    source: str | None = None
    source_id: str | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str = "none"
    estimated_minutes: int | None = None
    depends_on: list[str] | None = None
    created_at: datetime
    updated_at: datetime
    conversation_id: str | None = None
    subtask_count: int = 0
    completed_subtask_count: int = 0

    model_config = {"from_attributes": True}

    @field_validator("tags", mode="before")
    @classmethod
    def _parse_tags(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @field_validator("enabled_skills", mode="before")
    @classmethod
    def _parse_enabled_skills(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @field_validator("depends_on", mode="before")
    @classmethod
    def _parse_depends_on(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]


class TodoResponse(BaseModel):
    id: str
    title: str
    description: str | None = None
    status: str
    priority: str
    due_date: datetime | None = None
    completed_at: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int = 0
    source: str | None = None
    source_id: str | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str = "none"
    estimated_minutes: int | None = None
    depends_on: list[str] | None = None
    created_at: datetime
    updated_at: datetime
    clarification_questions: list[str] | None = None
    clarification_answers: dict[str, str] | None = None

    # Recurrence fields
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None
    is_recurring: bool = False
    recurring_source_id: str | None = None

    # Computed/display fields
    next_action: str | None = None
    plan_summary: str | None = None
    sync_status: str | None = None
    project_label: str | None = None

    model_config = {"from_attributes": True}

    @field_validator("tags", mode="before")
    @classmethod
    def _parse_tags(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @field_validator("enabled_skills", mode="before")
    @classmethod
    def _parse_enabled_skills(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @field_validator("clarification_questions", mode="before")
    @classmethod
    def _parse_clarification_questions(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @field_validator("depends_on", mode="before")
    @classmethod
    def _parse_depends_on(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @field_validator("clarification_answers", mode="before")
    @classmethod
    def _parse_clarification_answers(cls, v: object) -> dict[str, str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]
