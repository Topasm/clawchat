from pydantic import BaseModel

from domain.task import TaskStatus


class BulkTodoUpdate(BaseModel):
    ids: list[str]
    status: TaskStatus | None = None
    priority: str | None = None
    tags: list[str] | None = None
    delete: bool = False


class BulkTodoResponse(BaseModel):
    updated: int
    deleted: int
    errors: list[str]
