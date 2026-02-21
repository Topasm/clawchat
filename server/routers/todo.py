"""REST router for todo CRUD operations."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from schemas.todo import TodoCreate, TodoListResponse, TodoResponse, TodoUpdate
from services import todo_service

router = APIRouter(tags=["todos"])


@router.get("/", response_model=TodoListResponse)
async def list_todos(
    status_filter: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    due_before: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List todos with optional filters and pagination."""
    items, total = todo_service.get_todos(
        db,
        status_filter=status_filter,
        priority=priority,
        due_before=due_before,
        page=page,
        limit=limit,
    )
    return TodoListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


@router.post("/", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
async def create_todo(
    data: TodoCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new todo."""
    return todo_service.create_todo(db, data)


@router.get("/{todo_id}", response_model=TodoResponse)
async def get_todo(
    todo_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single todo by ID."""
    return todo_service.get_todo(db, todo_id)


@router.patch("/{todo_id}", response_model=TodoResponse)
async def update_todo(
    todo_id: str,
    data: TodoUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a todo."""
    return todo_service.update_todo(db, todo_id, data)


@router.delete("/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_todo(
    todo_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a todo."""
    todo_service.delete_todo(db, todo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
