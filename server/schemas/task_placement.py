"""Contracts for atomic Inbox/Tree placement commands."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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


class TaskBatchPlacementRequest(TaskPlacementRequest):
    todo_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("todo_ids")
    @classmethod
    def _validate_todo_ids(cls, value: list[str]) -> list[str]:
        if any(not todo_id.strip() for todo_id in value):
            raise ValueError("todo_ids must contain non-empty task IDs")
        if len(value) != len(set(value)):
            raise ValueError("todo_ids must not contain duplicates")
        return value


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
    graph_revision: int = Field(ge=0)
    affected_task_ids: list[str]
    insights_delta: TaskPlacementInsightsDelta | None = None
    change_set_id: str


class TaskPlacementGroup(BaseModel):
    todo_ids: list[str] = Field(min_length=1, max_length=100)
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

    @field_validator("todo_ids")
    @classmethod
    def _validate_todo_ids(cls, value: list[str]) -> list[str]:
        if any(not todo_id.strip() for todo_id in value):
            raise ValueError("todo_ids must contain non-empty task IDs")
        if len(value) != len(set(value)):
            raise ValueError("todo_ids must not contain duplicates")
        return value


class TaskGroupedPlacementRequest(BaseModel):
    groups: list[TaskPlacementGroup] = Field(min_length=1, max_length=20)
    expected_graph_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def _validate_unique_group_membership(self):
        todo_ids = [todo_id for group in self.groups for todo_id in group.todo_ids]
        if len(todo_ids) != len(set(todo_ids)):
            raise ValueError("A task can appear in only one placement group")
        return self
