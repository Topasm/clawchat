import json
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from domain.task import TaskStatus
from utils.vault_paths import normalize_vault_relative_path


def _normalize_source_id(value: str | None) -> str | None:
    if value is None:
        return None
    return normalize_vault_relative_path(value)


class TodoCreate(BaseModel):
    title: str
    description: str | None = None
    project_id: str | None = None
    status: TaskStatus = TaskStatus.PENDING
    priority: str = "medium"
    due_date: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int | None = None
    source: str | None = None
    source_id: str | None = None
    idempotency_key: str | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str = "none"
    estimated_minutes: int | None = None
    depends_on: list[str] | None = Field(
        default=None,
        description="Compatibility input; use /api/task-relationships instead",
        json_schema_extra={"deprecated": True},
    )
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None

    _validate_source_id = field_validator("source_id")(_normalize_source_id)

    @field_validator("idempotency_key")
    @classmethod
    def _normalize_idempotency_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return str(UUID(value))


class TodoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    project_id: str | None = None
    status: TaskStatus | None = None
    priority: str | None = None
    due_date: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str | None = None
    estimated_minutes: int | None = None
    depends_on: list[str] | None = Field(
        default=None,
        description="Compatibility input; use /api/task-relationships instead",
        json_schema_extra={"deprecated": True},
    )
    source: str | None = None
    source_id: str | None = None
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None
    client_updated_at: datetime | None = Field(
        default=None,
        description="Client edit time for last-write-wins offline synchronization",
    )

    _validate_source_id = field_validator("source_id")(_normalize_source_id)


class AnswerQuestionsRequest(BaseModel):
    """Request body for POST /todos/{id}/answer-questions."""
    answers: dict[str, str]  # maps question index (as string) to answer text


class ProjectTodoResponse(BaseModel):
    """Extended todo response used for the project list endpoint."""
    id: str
    title: str
    description: str | None = None
    project_id: str | None = None
    status: TaskStatus
    priority: str
    due_date: datetime | None = None
    completed_at: datetime | None = None
    tags: list[str] | None = None
    parent_id: str | None = None
    sort_order: int = 0
    source: str | None = None
    source_id: str | None = None
    idempotency_key: str | None = None
    assignee: str | None = None
    enabled_skills: list[str] | None = None
    inbox_state: str = "none"
    estimated_minutes: int | None = None
    depends_on: list[str] | None = Field(
        default=None,
        description="Deprecated compatibility shadow; use /api/task-relationships instead",
        json_schema_extra={"deprecated": True},
    )
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
    project_id: str | None = None
    status: TaskStatus
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
    depends_on: list[str] | None = Field(
        default=None,
        description="Deprecated compatibility shadow; use /api/task-relationships instead",
        json_schema_extra={"deprecated": True},
    )
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
