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
    inbox_state: str = "none"
    estimated_minutes: int | None = None


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
    inbox_state: str | None = None
    estimated_minutes: int | None = None
    source: str | None = None
    source_id: str | None = None


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
    inbox_state: str = "none"
    estimated_minutes: int | None = None
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
    inbox_state: str = "none"
    estimated_minutes: int | None = None
    created_at: datetime
    updated_at: datetime

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
