"""Pydantic schemas for chat operations (conversations and messages)."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Conversation schemas
# ---------------------------------------------------------------------------


class ConversationCreate(BaseModel):
    title: str = ""


class ConversationResponse(BaseModel):
    id: str
    title: str
    updated_at: datetime
    last_message_preview: str = ""
    is_archived: bool

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    items: list[ConversationResponse]
    total: int
    page: int
    limit: int


# ---------------------------------------------------------------------------
# Message schemas
# ---------------------------------------------------------------------------


class SendMessageRequest(BaseModel):
    conversation_id: str
    content: str


class SendMessageResponse(BaseModel):
    message_id: str
    conversation_id: str
    status: str = "delivered"


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    message_type: str
    intent: Optional[str] = None
    metadata: Optional[dict] = Field(None, validation_alias="metadata_")
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class MessageListResponse(BaseModel):
    items: list[MessageResponse]
    total: int
    page: int
    limit: int
