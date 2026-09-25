from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class NoteCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20_000)
    project_id: str | None = None
    idempotency_key: str | None = Field(None, min_length=1, max_length=64)

    @field_validator("content")
    @classmethod
    def content_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Enter a note")
        return value.strip()


class NoteUpdate(BaseModel):
    content: str | None = Field(None, min_length=1, max_length=20_000)
    project_id: str | None = None

    @field_validator("content")
    @classmethod
    def content_not_blank(cls, value):
        if value is None or not value.strip():
            raise ValueError("Enter a note")
        return value.strip()


class NoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    content: str
    project_id: str | None
    created_at: datetime
    updated_at: datetime
