"""Search router: full-text search stub for Phase 1."""

from fastapi import APIRouter, Depends, Query

from auth.dependencies import get_current_user

router = APIRouter(tags=["search"])


@router.get("")
async def search(
    q: str = Query("", description="Search query"),
    types: str = Query(
        "todos,events,memos,messages",
        description="Comma-separated types to search",
    ),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Full-text search across all data types. Stub for Phase 1."""
    return {"items": [], "total": 0, "page": page, "limit": limit}
