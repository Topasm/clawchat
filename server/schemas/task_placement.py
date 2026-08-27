"""Contracts for atomic Inbox/Tree placement commands."""

from typing import Literal

from pydantic import BaseModel, Field

from schemas.todo import TodoResponse


class TaskPlacementRequest(BaseModel):
    project_id: str | None = Field(...)
    parent_id: str | None = Field(...)
    before_id: str | None = None
    inbox_state: Literal[
        "none",
        "captured",
        "classifying",
        "questioning",
        "planning",
        "plan_ready",
        "error",
    ] | None = None
    expected_graph_revision: int = Field(ge=0)


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
