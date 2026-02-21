"""Pydantic schemas for memo operations."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class MemoCreate(BaseModel):
    title: str
    content: str
    tags: Optional[list[str]] = None


class MemoUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[list[str]] = None


class MemoResponse(BaseModel):
    id: str
    title: str
    content: str
    tags: Optional[list[str]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MemoListResponse(BaseModel):
    items: list[MemoResponse]
    total: int
    page: int
    limit: int
