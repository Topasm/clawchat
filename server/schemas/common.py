from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    limit: int


class ErrorDetail(BaseModel):
    """Structured application error nested in an API error response."""

    code: str
    message: str
    details: dict[str, object] | None = None


class ErrorResponse(BaseModel):
    """Named OpenAPI contract returned by ``AppError`` handlers."""

    error: ErrorDetail


class RequestValidationIssue(BaseModel):
    """One FastAPI/Pydantic request-validation issue."""

    loc: list[str | int]
    msg: str
    type: str
    input: object | None = None
    ctx: dict[str, object] | None = None


class RequestValidationErrorResponse(BaseModel):
    """Default FastAPI envelope for a request rejected before route entry."""

    detail: list[RequestValidationIssue]
