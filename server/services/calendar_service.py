"""Service layer for calendar event CRUD operations."""

from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.event import Event
from schemas.calendar import EventCreate, EventUpdate


def get_events(
    db: Session,
    *,
    start_after: Optional[datetime] = None,
    start_before: Optional[datetime] = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[Event], int]:
    """Query events with optional date-range filters and pagination.

    Returns a tuple of (items, total_count).
    """
    query = db.query(Event)

    if start_after is not None:
        query = query.filter(Event.start_time >= start_after)
    if start_before is not None:
        query = query.filter(Event.start_time <= start_before)

    query = query.order_by(Event.start_time.asc())

    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    return items, total


def get_event(db: Session, event_id: str) -> Event:
    """Get a single event by ID, or raise 404."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event {event_id} not found",
        )
    return event


def create_event(db: Session, data: EventCreate) -> Event:
    """Create a new event and return it."""
    event = Event(**data.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def update_event(db: Session, event_id: str, data: EventUpdate) -> Event:
    """Update an event with the provided fields."""
    event = get_event(db, event_id)
    update_data = data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(event, key, value)

    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, event_id: str) -> None:
    """Hard-delete an event. Raises 404 if not found."""
    event = get_event(db, event_id)
    db.delete(event)
    db.commit()
