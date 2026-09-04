import json as _json
from datetime import datetime

from pydantic import BaseModel, model_validator


class CreateConversationRequest(BaseModel):
    title: str = ""
    project_id: str | None = None
    project_todo_id: str | None = None


class ConversationResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    is_archived: bool
    last_message: str | None = None
    project_id: str | None = None
    project_todo_id: str | None = None
    metadata: dict | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _parse_metadata_json(cls, values):
        raw = (
            values.metadata_json
            if hasattr(values, "metadata_json")
            else (
                values.get("metadata_json", values.get("metadata"))
                if isinstance(values, dict)
                else None
            )
        )
        parsed = _json.loads(raw) if isinstance(raw, str) else raw
        if hasattr(values, "__dict__"):
            return {
                "id": values.id,
                "title": values.title,
                "created_at": values.created_at,
                "updated_at": values.updated_at,
                "is_archived": values.is_archived,
                "project_id": values.project_id,
                "project_todo_id": values.project_todo_id,
                "metadata": parsed,
            }
        if isinstance(values, dict):
            return {**values, "metadata": parsed}
        return values


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    message_type: str
    intent: str | None = None
    metadata: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _parse_metadata_json(cls, values):
        """Convert metadata_json (ORM column) to metadata (API field)."""
        raw = None
        if hasattr(values, "metadata_json"):
            raw = values.metadata_json
        elif isinstance(values, dict):
            raw = values.pop("metadata_json", None)
        parsed = _json.loads(raw) if isinstance(raw, str) else raw
        if hasattr(values, "__dict__"):
            # Always convert ORM objects.  SQLAlchemy's declarative base has a
            # class-level ``metadata`` attribute, so from_attributes otherwise
            # mistakes that MetaData object for this response field when the
            # message has no metadata_json value.
            d = {
                "id": values.id,
                "conversation_id": values.conversation_id,
                "role": values.role,
                "content": values.content,
                "message_type": values.message_type,
                "intent": values.intent,
                "created_at": values.created_at,
                "metadata": parsed,
            }
            return d
        if raw:
            values["metadata"] = parsed
        return values


class SendMessageRequest(BaseModel):
    conversation_id: str
    content: str
    # Clients generate one per send and reuse it across retries, so a request
    # that fails after the server committed the message does not create a
    # second copy. Optional: older clients omit it.
    idempotency_key: str | None = None


class SendMessageResponse(BaseModel):
    message_id: str
    conversation_id: str
    # The user message is durable before the 202 is returned.  Assistant
    # delivery is acknowledged separately by the final WebSocket event.
    status: str = "accepted"


class MessageEditRequest(BaseModel):
    content: str


class ConversationDetailResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    is_archived: bool
    project_id: str | None = None
    project_todo_id: str | None = None
    messages: list[MessageResponse] = []

    model_config = {"from_attributes": True}
