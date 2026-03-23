"""Recurring task service — compute next occurrence and spawn new todos."""

import json
import logging
from datetime import datetime, timezone

from dateutil.rrule import rrulestr
from sqlalchemy.ext.asyncio import AsyncSession

from models.todo import Todo
from utils import make_id

logger = logging.getLogger(__name__)


def compute_next_occurrence(
    recurrence_rule: str,
    dtstart: datetime,
    after: datetime,
    recurrence_end: datetime | None = None,
    exceptions_json: str | None = None,
) -> datetime | None:
    """Compute the next occurrence of a recurring task after the given datetime.

    Returns None if the series is finished (end reached or no more dates).
    """
    try:
        rule = rrulestr(recurrence_rule, dtstart=dtstart)
    except (ValueError, TypeError):
        logger.warning("Invalid RRULE: %s", recurrence_rule)
        return None

    # Parse exception dates
    exceptions: set[str] = set()
    if exceptions_json:
        try:
            exceptions = set(json.loads(exceptions_json))
        except (json.JSONDecodeError, TypeError):
            pass

    # Search forward from `after`
    next_dt = rule.after(after, inc=False)
    while next_dt is not None:
        # Check recurrence end
        if recurrence_end and next_dt > recurrence_end:
            return None

        # Check exceptions
        date_key = next_dt.date().isoformat()
        if date_key not in exceptions:
            return next_dt

        # Skip this exception and try the next one
        next_dt = rule.after(next_dt, inc=False)

    return None


async def spawn_next_occurrence(db: AsyncSession, completed_todo: Todo) -> Todo | None:
    """When a recurring todo is completed, create the next pending occurrence.

    Returns the new todo or None if the series is finished.
    """
    if not completed_todo.recurrence_rule:
        return None

    # Use the completed todo's due_date as the reference point for computing next
    reference = completed_todo.due_date or completed_todo.completed_at or datetime.now(timezone.utc)

    next_due = compute_next_occurrence(
        recurrence_rule=completed_todo.recurrence_rule,
        dtstart=reference,
        after=reference,
        recurrence_end=completed_todo.recurrence_end,
        exceptions_json=completed_todo.recurrence_exceptions,
    )

    if next_due is None:
        logger.info("Recurring series finished for todo %s", completed_todo.id)
        return None

    # Determine the series source ID (original todo that started the series)
    series_id = completed_todo.recurring_source_id or completed_todo.id

    new_todo = Todo(
        id=make_id("todo_"),
        title=completed_todo.title,
        description=completed_todo.description,
        status="pending",
        priority=completed_todo.priority,
        due_date=next_due,
        tags=completed_todo.tags,
        parent_id=completed_todo.parent_id,
        sort_order=completed_todo.sort_order,
        source=completed_todo.source,
        source_id=completed_todo.source_id,
        estimated_minutes=completed_todo.estimated_minutes,
        recurrence_rule=completed_todo.recurrence_rule,
        recurrence_end=completed_todo.recurrence_end,
        recurrence_exceptions=completed_todo.recurrence_exceptions,
        recurring_source_id=series_id,
    )
    db.add(new_todo)
    await db.flush()

    logger.info(
        "Spawned next recurring todo %s (due %s) from %s",
        new_todo.id,
        next_due.isoformat(),
        completed_todo.id,
    )
    return new_todo
