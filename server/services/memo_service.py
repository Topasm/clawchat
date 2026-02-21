"""Service layer for memo CRUD operations."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.memo import Memo
from schemas.memo import MemoCreate, MemoUpdate


def get_memos(
    db: Session,
    *,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Memo], int]:
    """List all memos ordered by updated_at DESC, paginated.

    Returns a tuple of (items, total_count).
    """
    query = db.query(Memo).order_by(Memo.updated_at.desc())

    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    return items, total


def get_memo(db: Session, memo_id: str) -> Memo:
    """Get a single memo by ID, or raise 404."""
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if memo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memo {memo_id} not found",
        )
    return memo


def create_memo(db: Session, data: MemoCreate) -> Memo:
    """Create a new memo and return it."""
    memo = Memo(**data.model_dump())
    db.add(memo)
    db.commit()
    db.refresh(memo)
    return memo


def update_memo(db: Session, memo_id: str, data: MemoUpdate) -> Memo:
    """Update a memo with the provided fields."""
    memo = get_memo(db, memo_id)
    update_data = data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(memo, key, value)

    db.commit()
    db.refresh(memo)
    return memo


def delete_memo(db: Session, memo_id: str) -> None:
    """Hard-delete a memo. Raises 404 if not found."""
    memo = get_memo(db, memo_id)
    db.delete(memo)
    db.commit()
