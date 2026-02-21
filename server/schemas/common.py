"""Shared pagination response schema."""

from pydantic import BaseModel


class PaginatedResponse(BaseModel):
    total: int
    page: int
    limit: int
