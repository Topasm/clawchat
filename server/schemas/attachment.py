
from pydantic import BaseModel
from schemas._utc import UtcDatetime


class AttachmentResponse(BaseModel):
    id: str
    filename: str
    stored_filename: str
    content_type: str
    size_bytes: int
    todo_id: str | None = None
    url: str
    created_at: UtcDatetime

    model_config = {"from_attributes": True}
