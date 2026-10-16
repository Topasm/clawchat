"""Contracts for adding and moving steps in one task's flow."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from schemas.todo import TodoResponse


class TaskStepCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    #: Absent, the step goes after the flow's current last steps (all of them,
    #: so a step typed after two branches waits for both). Present, the new
    #: step forks from the same prerequisites as this sibling step, and the
    #: steps waiting on that sibling wait on the new one too.
    branch_from_id: str | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value


class TaskStepMove(BaseModel):
    step_id: str = Field(min_length=1)
    #: The sibling the step should come right after; null moves it to the start.
    after_id: str | None = None


class TaskStepResponse(BaseModel):
    #: The step that was created, or the step that was moved.
    todo: TodoResponse
    change_id: str
    affected_task_ids: list[str]


class TaskStepUndoResponse(BaseModel):
    change_id: str
    reverted: bool = True
    affected_task_ids: list[str]


TodoPathKind = Literal["device", "vault", "url"]


class TodoPathCreate(BaseModel):
    kind: TodoPathKind
    path: str = Field(min_length=1, max_length=4000)
    host_id: str | None = None
    label: str | None = Field(default=None, max_length=200)

    @field_validator("path")
    @classmethod
    def _strip_path(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("path must not be blank")
        return value


class TodoPathResponse(BaseModel):
    id: str
    #: The task the path is attached to; an ancestor's when ``inherited``.
    todo_id: str | None = None
    kind: TodoPathKind
    host_id: str | None = None
    host_label: str | None = None
    path: str
    label: str | None = None
    #: Shown dimmed: it belongs to a parent task or to the project.
    inherited: bool = False
    created_at: datetime | None = None
