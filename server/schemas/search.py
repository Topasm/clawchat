from datetime import datetime

from pydantic import BaseModel


class SearchHit(BaseModel):
    type: str  # "message" | "todo" | "event"
    id: str
    title: str | None = None
    preview: str
    rank: float
    created_at: datetime
