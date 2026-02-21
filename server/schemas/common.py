"""Shared response schemas: pagination, error format, and search results."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class PaginatedResponse(BaseModel):
    total: int
    page: int
    limit: int


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[dict[str, Any]] = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class SearchResultItem(BaseModel):
    type: str  # todo, event, memo, message
    id: str
    title: str
    snippet: str = ""
    score: float = 0.0
    created_at: Optional[str] = None


class SearchResponse(BaseModel):
    items: list[SearchResultItem]
    total: int
    page: int
    limit: int
