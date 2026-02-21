"""Search router: full-text search across todos, events, memos, and messages."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from services.search_service import search as search_items

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
    db: Session = Depends(get_db),
):
    """Full-text search across all data types."""
    type_list = [t.strip() for t in types.split(",") if t.strip()]
    items, total = search_items(db, q=q, types=type_list, page=page, limit=limit)
    return {"items": items, "total": total, "page": page, "limit": limit}
