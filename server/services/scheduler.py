"""APScheduler-based reminder and overdue task checker."""

import logging
from datetime import datetime, timedelta, timezone

from database import SessionLocal
from models.event import Event
from models.todo import Todo

logger = logging.getLogger(__name__)


def check_reminders():
    """Find events whose reminder time has arrived and log them.

    In a full implementation this would send push notifications via Expo.
    """
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        events = (
            db.query(Event)
            .filter(
                Event.reminder_minutes != None,
                Event.start_time > now,
            )
            .all()
        )
        for event in events:
            remind_at = event.start_time - timedelta(minutes=event.reminder_minutes)
            if remind_at <= now:
                logger.info("Reminder due for event '%s' (id=%s)", event.title, event.id)
    finally:
        db.close()


def check_overdue_tasks():
    """Log tasks that are past their due date and still pending."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        overdue = (
            db.query(Todo)
            .filter(
                Todo.due_date < now,
                Todo.status.in_(["pending", "in_progress"]),
            )
            .all()
        )
        for todo in overdue:
            logger.info("Overdue task: '%s' (id=%s, due=%s)", todo.title, todo.id, todo.due_date)
    finally:
        db.close()
