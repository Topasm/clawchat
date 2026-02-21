"""Service layer for todo CRUD operations."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.todo import Todo
from schemas.todo import TodoCreate, TodoUpdate


def get_todos(
    db: Session,
    *,
    status_filter: Optional[str] = None,
    priority: Optional[str] = None,
    due_before: Optional[datetime] = None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Todo], int]:
    """Query todos with optional filters and pagination.

    Returns a tuple of (items, total_count).
    """
    query = db.query(Todo)

    if status_filter is not None:
        query = query.filter(Todo.status == status_filter)
    if priority is not None:
        query = query.filter(Todo.priority == priority)
    if due_before is not None:
        query = query.filter(Todo.due_date <= due_before)

    query = query.order_by(Todo.created_at.desc())

    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    return items, total


def get_todo(db: Session, todo_id: str) -> Todo:
    """Get a single todo by ID, or raise 404."""
    todo = db.query(Todo).filter(Todo.id == todo_id).first()
    if todo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Todo {todo_id} not found",
        )
    return todo


def create_todo(db: Session, data: TodoCreate) -> Todo:
    """Create a new todo and return it."""
    todo = Todo(**data.model_dump())
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


def update_todo(db: Session, todo_id: str, data: TodoUpdate) -> Todo:
    """Update a todo with the provided fields.

    If status changes to 'completed', automatically sets completed_at.
    """
    todo = get_todo(db, todo_id)
    update_data = data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(todo, key, value)

    # Auto-set completed_at when status transitions to completed
    if "status" in update_data and update_data["status"] == "completed":
        todo.completed_at = datetime.now(timezone.utc)
    elif "status" in update_data and update_data["status"] != "completed":
        todo.completed_at = None

    db.commit()
    db.refresh(todo)
    return todo


def delete_todo(db: Session, todo_id: str) -> None:
    """Hard-delete a todo. Raises 404 if not found."""
    todo = get_todo(db, todo_id)
    db.delete(todo)
    db.commit()
