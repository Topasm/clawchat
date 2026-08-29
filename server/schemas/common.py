from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel

T = TypeVar("T")


def _reject_blank_or_duplicate_ids(value: list[str]) -> list[str]:
    """Reject blank entries and repeats in a batch of task IDs.

    The three batch task commands -- Inbox triage preview, batch placement and
    grouped placement -- each carried a byte-identical copy of this check, so a
    fix applied to one silently left the other two behind.  The messages are
    part of the 422 body clients render, so they are reproduced verbatim.
    """
    if any(not todo_id.strip() for todo_id in value):
        raise ValueError("todo_ids must contain non-empty task IDs")
    if len(value) != len(set(value)):
        raise ValueError("todo_ids must not contain duplicates")
    return value


#: A ``todo_ids`` batch. Per-request size limits stay on the field itself.
TodoIdList = Annotated[list[str], AfterValidator(_reject_blank_or_duplicate_ids)]


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
