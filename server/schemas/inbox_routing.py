"""Where the Inbox sent a capture, as the "Just organized" list shows it."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from schemas._utc import UtcDatetime


class InboxRoutingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    origin: Literal["auto", "user"]
    kind: Literal["task", "note"]
    todo_id: str | None
    note_id: str | None
    title: str
    original_title: str
    due_date: UtcDatetime | None
    project_folder: str | None
    kind_confidence: float | None = None
    created_at: UtcDatetime
    reverted_at: UtcDatetime | None


class InboxRoutingListResponse(BaseModel):
    items: list[InboxRoutingResponse]
    auto_organize: bool


class InboxRoutingAcknowledgeResponse(BaseModel):
    acknowledged: int
