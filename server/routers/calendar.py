"""REST router for calendar event CRUD operations."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from schemas.calendar import EventCreate, EventListResponse, EventResponse, EventUpdate
from services import calendar_service

router = APIRouter(tags=["calendar"])


@router.get("/", response_model=EventListResponse)
async def list_events(
    start_after: Optional[datetime] = None,
    start_before: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List events with optional date-range filters and pagination."""
    items, total = calendar_service.get_events(
        db,
        start_after=start_after,
        start_before=start_before,
        page=page,
        limit=limit,
    )
    return EventListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: EventCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new calendar event."""
    return calendar_service.create_event(db, data)


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single event by ID."""
    return calendar_service.get_event(db, event_id)


@router.patch("/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: str,
    data: EventUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a calendar event."""
    return calendar_service.update_event(db, event_id, data)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a calendar event."""
    calendar_service.delete_event(db, event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
