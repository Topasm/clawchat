
from pydantic import BaseModel
from schemas._utc import UtcDatetime


class SearchHit(BaseModel):
    type: str  # "message" | "todo" | "event"
    id: str
    title: str | None = None
    preview: str
    rank: float
    created_at: UtcDatetime
