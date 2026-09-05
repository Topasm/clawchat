"""Contracts for atomic Inbox/Tree placement commands."""

from typing import Literal
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from schemas.common import TodoIdList
from schemas.todo import TodoResponse


class TaskPlacementRequest(BaseModel):
    project_id: str | None = Field(...)
    parent_id: str | None = Field(...)
    before_id: str | None = None
    inbox_state: (
        Literal[
            "none",
            "captured",
            "classifying",
            "questioning",
            "planning",
            "plan_ready",
            "error",
        ]
        | None
    ) = None
    expected_graph_revision: int = Field(ge=0)
    # Omitted/null preserves the current deadline. Approval can set a proposed one.
    due_date: datetime | None = None


class TaskBatchPlacementRequest(TaskPlacementRequest):
    todo_ids: TodoIdList = Field(min_length=1, max_length=100)


class TaskPlacementInsightsDelta(BaseModel):
    ready_count: int = 0
    blocked_count: int = 0
    critical_path_minutes: int | None = None


class TaskPlacementResponse(BaseModel):
    todo: TodoResponse
    graph_revision: int = Field(ge=0)
    affected_task_ids: list[str]
    insights_delta: TaskPlacementInsightsDelta | None = None
    change_set_id: str
    reverted: bool = False


class TaskBatchPlacementResponse(BaseModel):
    todos: list[TodoResponse]
    created_todos: list[TodoResponse] = Field(default_factory=list)
    graph_revision: int = Field(ge=0)
    affected_task_ids: list[str]
    insights_delta: TaskPlacementInsightsDelta | None = None
    change_set_id: str


class TaskPlacementNewParent(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    parent_id: str | None = None

    @field_validator("title")
    @classmethod
    def _normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("New parent title must not be blank")
        return normalized


class TaskPlacementGroup(BaseModel):
    todo_ids: TodoIdList = Field(min_length=1, max_length=100)
    project_id: str | None = Field(...)
    parent_id: str | None = Field(...)
    before_id: str | None = None
    create_parent: TaskPlacementNewParent | None = None
    inbox_state: (
        Literal[
            "none",
            "captured",
            "classifying",
            "questioning",
            "planning",
            "plan_ready",
            "error",
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def _validate_destination(self):
        if self.create_parent is not None and (
            self.parent_id is not None or self.before_id is not None
        ):
            raise ValueError(
                "parent_id and before_id must be null when create_parent is supplied"
            )
        if self.create_parent is not None and self.project_id is None:
            raise ValueError("A new parent requires a project destination")
        return self


class TaskGroupedPlacementRequest(BaseModel):
    groups: list[TaskPlacementGroup] = Field(min_length=1, max_length=20)
    expected_graph_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def _validate_unique_group_membership(self):
        todo_ids = [todo_id for group in self.groups for todo_id in group.todo_ids]
        if len(todo_ids) != len(set(todo_ids)):
            raise ValueError("A task can appear in only one placement group")
        return self
