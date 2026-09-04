"""Async service layer for calendar event CRUD operations."""

import json
from datetime import datetime, timedelta, timezone

from icalendar import Alarm, Calendar, Event as ICalEvent
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.task import TaskStatus
from exceptions import NotFoundError
from models.event import Event
from models.project import Project
from models.todo import Todo
from services.calendar.recurrence_service import generate_occurrences
from utils import apply_model_updates, make_id, serialize_tags


async def get_events(
    db: AsyncSession,
    *,
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    project_id: str | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[Event | dict], int]:
    conditions = []
    if start_after is not None:
        conditions.append(Event.start_time >= start_after)
    if start_before is not None:
        conditions.append(Event.start_time <= start_before)
    if project_id is not None:
        conditions.append(Event.project_id == project_id)

    def sort_key(item: Event | dict):
        if isinstance(item, dict):
            st = item["start_time"]
            return st if isinstance(st, datetime) else datetime.fromisoformat(st)
        return item.start_time

    expanding = bool(start_after and start_before)

    if not expanding:
        # No range to expand into, so the database can do the paging.
        total = (await db.execute(select(func.count(Event.id)).where(*conditions))).scalar() or 0
        rows = (
            await db.execute(
                select(Event)
                .where(*conditions)
                .order_by(Event.start_time.asc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        ).scalars().all()
        return list(rows), total

    # Occurrences are generated in memory, so they cannot be paged by the
    # database. Paging the stored rows alone appended the whole expansion to
    # every page, repeating occurrences and overrunning the limit. Build the
    # combined series first, then page it.
    stored = (
        await db.execute(select(Event).where(*conditions).order_by(Event.start_time.asc()))
    ).scalars().all()
    results: list[Event | dict] = list(stored)

    recurring_q = select(Event).where(Event.recurrence_rule != None)  # noqa: E711
    if project_id is not None:
        recurring_q = recurring_q.where(Event.project_id == project_id)
    for recurring in (await db.execute(recurring_q)).scalars().all():
        results.extend(generate_occurrences(recurring, start_after, start_before))

    results.sort(key=sort_key)
    total = len(results)
    offset = (page - 1) * limit
    return results[offset : offset + limit], total


async def get_event(db: AsyncSession, event_id: str) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise NotFoundError(f"Event {event_id} not found")
    return event


async def create_event(
    db: AsyncSession,
    *,
    title: str,
    description: str | None = None,
    project_id: str | None = None,
    start_time: datetime,
    end_time: datetime | None = None,
    location: str | None = None,
    is_all_day: bool = False,
    reminder_minutes: int | None = None,
    recurrence_rule: str | None = None,
    recurrence_end: datetime | None = None,
    tags: list[str] | None = None,
) -> Event:
    if project_id is not None and await db.get(Project, project_id) is None:
        raise NotFoundError(f"Project {project_id} not found")
    event = Event(
        id=make_id("evt_"),
        title=title,
        description=description,
        project_id=project_id,
        start_time=start_time,
        end_time=end_time,
        location=location,
        is_all_day=is_all_day,
        reminder_minutes=reminder_minutes,
        recurrence_rule=recurrence_rule,
        recurrence_end=recurrence_end,
        tags=serialize_tags(tags),
    )
    db.add(event)
    await db.flush()
    return event


async def update_event(db: AsyncSession, event_id: str, **updates) -> Event:
    event = await get_event(db, event_id)
    if (
        "project_id" in updates
        and updates["project_id"] is not None
        and await db.get(Project, updates["project_id"]) is None
    ):
        raise NotFoundError(f"Project {updates['project_id']} not found")
    apply_model_updates(event, updates)
    await db.flush()
    return event


async def delete_event(db: AsyncSession, event_id: str) -> None:
    event = await get_event(db, event_id)
    await db.delete(event)
    await db.flush()


async def delete_event_occurrence(
    db: AsyncSession, event_id: str, occurrence_date: str, mode: str
) -> None:
    """Delete a recurring event occurrence.

    mode: 'this_only' — adds to exceptions list
          'this_and_future' — sets recurrence_end to this date
          'all' — deletes entire series
    """
    event = await get_event(db, event_id)

    if mode == "all":
        await db.delete(event)
        await db.flush()
        return

    if mode == "this_and_future":
        # recurrence_end is inclusive during expansion, so ending the series
        # exactly at the occurrence's date keeps that occurrence whenever it
        # starts at midnight -- every all-day event. End the series just before
        # the chosen date instead, which drops it at any time of day.
        occ_dt = datetime.fromisoformat(occurrence_date).replace(tzinfo=timezone.utc)
        event.recurrence_end = occ_dt - timedelta(microseconds=1)
        event.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return

    # mode == "this_only" — add to exceptions
    exceptions: list[str] = []
    if event.recurrence_exceptions:
        try:
            exceptions = json.loads(event.recurrence_exceptions)
        except (json.JSONDecodeError, TypeError):
            exceptions = []
    if occurrence_date not in exceptions:
        exceptions.append(occurrence_date)
    event.recurrence_exceptions = json.dumps(exceptions)
    event.updated_at = datetime.now(timezone.utc)
    await db.flush()


async def export_events_ical(db: AsyncSession) -> str:
    """Export the calendar -- events and task deadlines -- as an iCalendar string."""
    q = select(Event).order_by(Event.start_time.asc())
    rows = (await db.execute(q)).scalars().all()

    cal = Calendar()
    cal.add("prodid", "-//ClawChat//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")

    for event in rows:
        vevent = ICalEvent()
        vevent.add("uid", event.id)
        vevent.add("summary", event.title)
        vevent.add("dtstamp", datetime.now(timezone.utc))

        if event.is_all_day:
            vevent.add("dtstart", event.start_time.date())
            if event.end_time:
                vevent.add("dtend", event.end_time.date())
        else:
            vevent.add("dtstart", event.start_time)
            if event.end_time:
                vevent.add("dtend", event.end_time)

        if event.description:
            vevent.add("description", event.description)
        if event.location:
            vevent.add("location", event.location)

        if event.recurrence_rule:
            # recurrence_rule is stored as an RRULE string like "FREQ=WEEKLY;BYDAY=MO"
            params: dict[str, str | list[str]] = {}
            for part in event.recurrence_rule.split(";"):
                if "=" not in part:
                    continue
                key, val = part.split("=", 1)
                # BYDAY etc. can have multiple values
                if "," in val:
                    params[key] = val.split(",")
                else:
                    params[key] = val
            vevent.add("rrule", params)

        if event.recurrence_exceptions:
            try:
                exception_dates = json.loads(event.recurrence_exceptions)
                for exc_date_str in exception_dates:
                    exc_dt = datetime.fromisoformat(exc_date_str)
                    if event.is_all_day:
                        vevent.add("exdate", exc_dt.date())
                    else:
                        if exc_dt.tzinfo is None:
                            exc_dt = exc_dt.replace(tzinfo=timezone.utc)
                        vevent.add("exdate", exc_dt)
            except (json.JSONDecodeError, TypeError):
                pass

        if event.reminder_minutes is not None:
            alarm = Alarm()
            alarm.add("action", "DISPLAY")
            alarm.add("description", f"Reminder: {event.title}")
            alarm.add("trigger", timedelta(minutes=-event.reminder_minutes))
            vevent.add_component(alarm)

        vevent.add("created", event.created_at)
        vevent.add("last-modified", event.updated_at)

        cal.add_component(vevent)

    for todo in await _open_deadlines(db):
        cal.add_component(_deadline_vevent(todo))

    return cal.to_ical().decode("utf-8")


async def _open_deadlines(db: AsyncSession) -> list[Todo]:
    """Tasks a subscriber still has to finish, oldest deadline first."""
    q = (
        select(Todo)
        .where(
            Todo.due_date.is_not(None),
            Todo.status.not_in([TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value]),
        )
        .order_by(Todo.due_date.asc())
    )
    return list((await db.execute(q)).scalars().all())


def _deadline_vevent(todo: Todo) -> ICalEvent:
    """A deadline as an all-day entry on the day it is due.

    Task-oriented workspaces still want deadlines to show up in whatever
    calendar the person actually looks at, and every client renders an all-day
    VEVENT. VTODO would be more literal, but Google and most subscription
    readers drop it, so the deadline would silently vanish.

    The entry sits on the due date rather than spanning from today, because a
    subscription is re-read for months and a span computed now would be wrong
    tomorrow.
    """
    vevent = ICalEvent()
    vevent.add("uid", todo.id)
    vevent.add("summary", todo.title)
    vevent.add("dtstamp", datetime.now(timezone.utc))
    vevent.add("dtstart", todo.due_date.date())
    vevent.add("categories", ["TASK"])
    if todo.description:
        vevent.add("description", todo.description)
    vevent.add("created", todo.created_at)
    vevent.add("last-modified", todo.updated_at)
    return vevent
