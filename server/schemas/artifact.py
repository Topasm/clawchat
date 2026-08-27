"""Contracts for durable, versioned project artifacts."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from domain.review import ArtifactRevisionStatus, ArtifactType


class ArtifactCreate(BaseModel):
    type: ArtifactType
    title: str = Field(min_length=1, max_length=500)
    content: str = Field(default="", max_length=1_000_000)
    task_id: str | None = None
    source: str = Field(default="human", min_length=1, max_length=100)
    created_by: str | None = Field(default=None, max_length=200)


class ArtifactRevisionCreate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    content: str = Field(max_length=1_000_000)
    source: str = Field(default="human", min_length=1, max_length=100)
    created_by: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=2_000)


class ArtifactResponse(BaseModel):
    id: str
    project_id: str
    task_id: str | None = None
    type: ArtifactType
    title: str
    content: str
    current_version: int = Field(ge=1)
    source: str
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ArtifactRevisionResponse(BaseModel):
    id: str
    artifact_id: str
    version: int = Field(ge=1)
    title: str
    content: str
    source: str
    created_by: str | None = None
    status: ArtifactRevisionStatus
    created_at: datetime
    reviewed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
