"""API schemas for user-authored task comment threads."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

NonBlankComment = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
]


class TaskCommentCreate(BaseModel):
    """Post one comment onto a task's thread."""

    todo_id: str
    content: NonBlankComment
    idempotency_key: UUID | None = None

    model_config = ConfigDict(extra="forbid")


class TaskCommentResponse(BaseModel):
    """Persisted task comment returned by the API."""

    id: str
    todo_id: str
    content: str
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
