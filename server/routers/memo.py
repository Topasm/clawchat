"""REST router for memo CRUD operations."""

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from schemas.memo import MemoCreate, MemoListResponse, MemoResponse, MemoUpdate
from services import memo_service

router = APIRouter(tags=["memos"])


@router.get("/", response_model=MemoListResponse)
async def list_memos(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List memos sorted by updated_at DESC with pagination."""
    items, total = memo_service.get_memos(
        db,
        page=page,
        limit=limit,
    )
    return MemoListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


@router.post("/", response_model=MemoResponse, status_code=status.HTTP_201_CREATED)
async def create_memo(
    data: MemoCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new memo."""
    return memo_service.create_memo(db, data)


@router.get("/{memo_id}", response_model=MemoResponse)
async def get_memo(
    memo_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single memo by ID."""
    return memo_service.get_memo(db, memo_id)


@router.patch("/{memo_id}", response_model=MemoResponse)
async def update_memo(
    memo_id: str,
    data: MemoUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a memo."""
    return memo_service.update_memo(db, memo_id, data)


@router.delete("/{memo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memo(
    memo_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a memo."""
    memo_service.delete_memo(db, memo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
