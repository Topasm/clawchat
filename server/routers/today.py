"""Consolidated today dashboard endpoint."""

from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from models.event import Event
from models.todo import Todo
from schemas.today import TodayResponse

router = APIRouter(tags=["today"])


def _get_greeting() -> str:
    hour = datetime.now().hour
    if hour < 12:
        return "Good morning"
    if hour < 17:
        return "Good afternoon"
    return "Good evening"


@router.get("", response_model=TodayResponse)
async def get_today(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return consolidated today dashboard data."""
    today = date.today()
    today_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    today_end = datetime.combine(today, time.max, tzinfo=timezone.utc)

    today_tasks = (
        db.query(Todo)
        .filter(
            Todo.due_date >= today_start,
            Todo.due_date <= today_end,
            Todo.status.notin_(["completed", "cancelled"]),
        )
        .order_by(Todo.created_at.asc())
        .all()
    )

    in_progress = (
        db.query(Todo)
        .filter(
            Todo.status == "in_progress",
            (Todo.due_date == None) | (Todo.due_date < today_start) | (Todo.due_date > today_end),
        )
        .all()
    )
    today_tasks = today_tasks + in_progress

    overdue_tasks = (
        db.query(Todo)
        .filter(
            Todo.due_date < today_start,
            Todo.status.in_(["pending", "in_progress"]),
        )
        .order_by(Todo.due_date.asc())
        .all()
    )

    today_events = (
        db.query(Event)
        .filter(Event.start_time >= today_start, Event.start_time <= today_end)
        .order_by(Event.start_time.asc())
        .all()
    )

    inbox_count = (
        db.query(Todo)
        .filter(Todo.due_date == None, Todo.status == "pending")
        .count()
    )

    return TodayResponse(
        today_tasks=today_tasks,
        overdue_tasks=overdue_tasks,
        today_events=today_events,
        inbox_count=inbox_count,
        greeting=_get_greeting(),
        date=today,
    )
