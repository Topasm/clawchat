"""Move an Inbox capture to a task or a note, record it, and put it back.

A task keeps its row and leaves the Inbox (``inbox_state = none``) with the
deadline its title named; a note replaces the task row. Each move writes an
``InboxRouting`` whose ``before_json`` restores the item exactly, under the
same id, so undo never leaves a copy behind.
"""

import json
from datetime import datetime, timedelta, timezone

from domain.task import TaskStatus
from exceptions import AppError, NotFoundError
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.attachment import Attachment
from models.event import Event
from models.inbox_routing import InboxRouting
from models.note import Note
from models.plan_proposal import PlanProposal
from models.project import Project
from models.task_comment import TaskComment
from models.task_relationship import TaskRelationship
from models.todo import Todo
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from services.planning.inbox_deadline import (
    ParsedDeadline,
    Zone,
    as_zone,
    capture_day,
    due_instant,
    parse_deadline,
)
from services.calendar import calendar_service
from services.review import review_item_service

# How long a move stays under "Just organized" unless the user clears it.
RECENT_WINDOW = timedelta(hours=24)
_TITLE_LIMIT = 500

# Restored on undo of a task move, and the guard that the row is still the
# capture the move produced.
_TASK_FIELDS = ("title", "description", "due_date", "inbox_state", "source", "source_id")
# An event made from a capture lasts this long unless the text says otherwise.
DEFAULT_EVENT_LENGTH = timedelta(hours=1)
# Every column a note move must recreate, other than the timestamps.
_ROW_FIELDS = (
    "id",
    "title",
    "description",
    "project_id",
    "status",
    "priority",
    "due_date",
    "tags",
    "sort_order",
    "source",
    "source_id",
    "idempotency_key",
    "assignee",
    "enabled_skills",
    "inbox_state",
    "estimated_minutes",
    "clarification_questions",
    "clarification_answers",
)


def _cannot_move(message: str, **details: object) -> AppError:
    return AppError(
        code="INBOX_ROUTING_NOT_ALLOWED",
        message=message,
        status_code=409,
        details=details,
    )


def _encode(value: object) -> object:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return value


def _decode_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    return datetime.fromisoformat(value)


def _todo_row(todo: Todo) -> dict[str, object]:
    row = {field: _encode(getattr(todo, field)) for field in _ROW_FIELDS}
    row["created_at"] = _encode(todo.created_at)
    return row


def _note_row(note: Note) -> dict[str, object]:
    return {
        "id": note.id,
        "content": note.content,
        "project_id": note.project_id,
        "idempotency_key": note.idempotency_key,
        "created_at": _encode(note.created_at),
    }


def _event_row(event: Event) -> dict[str, object]:
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "project_id": event.project_id,
        "start_time": _encode(event.start_time),
        "end_time": _encode(event.end_time),
        "location": event.location,
        "is_all_day": event.is_all_day,
        "tags": event.tags,
        "created_at": _encode(event.created_at),
    }


def deadline_for(todo: Todo, zone: Zone) -> ParsedDeadline | None:
    return parse_deadline(todo.title, capture_day(todo.created_at, zone))


def _record(db: AsyncSession, **values: object) -> InboxRouting:
    routing = InboxRouting(**values)
    db.add(routing)
    return routing


def task_patch(
    *,
    current_due: datetime | None,
    deadline: ParsedDeadline | None,
    zone: Zone,
    fallback_due: datetime | None = None,
    original: str | None = None,
    current_description: str | None = None,
    summary: str | None = None,
) -> dict[str, object]:
    """The fields a task move writes: out of the Inbox, with its deadline.

    The title is what is left once the date expression is removed, or the
    classifier's ``summary`` of a long capture. Whenever that differs from the
    text as typed (``original``), the typed text is kept as the description
    unless the task already has one, so nothing the user wrote is lost.
    """
    patch: dict[str, object] = {"inbox_state": "none", "automation_error": None}
    if current_due is None:
        if deadline is not None:
            patch["due_date"] = due_instant(deadline, zone)
            patch["title"] = deadline.stripped_title[:_TITLE_LIMIT]
        elif fallback_due is not None:
            patch["due_date"] = fallback_due
    if summary:
        patch["title"] = summary[:_TITLE_LIMIT]
    title = patch.get("title")
    if (
        original is not None
        and isinstance(title, str)
        and title.strip() != original.strip()
        and not (current_description or "").strip()
    ):
        patch["description"] = original
    return patch


def record_task_move(
    db: AsyncSession,
    *,
    before: dict[str, object],
    todo_id: str,
    title: str,
    due_date: datetime | None,
    origin: str,
    project_folder: str | None = None,
    kind_confidence: float | None = None,
) -> InboxRouting:
    return _record(
        db,
        origin=origin,
        kind_confidence=kind_confidence,
        kind="task",
        todo_id=todo_id,
        title=title,
        original_title=str(before["title"]),
        due_date=due_date,
        project_folder=project_folder,
        before_json=json.dumps({"type": "todo_fields", **before}),
    )


def task_snapshot(todo: Todo) -> dict[str, object]:
    return {field: _encode(getattr(todo, field)) for field in _TASK_FIELDS}


async def file_as_task(
    db: AsyncSession, todo: Todo, *, origin: str, zone: Zone
) -> InboxRouting:
    """Take a capture out of the Inbox as a task, with the deadline it names."""
    if todo.inbox_state == "none":
        raise _cannot_move("This task is not in the Inbox", todo_id=todo.id)
    before = task_snapshot(todo)
    # Undo puts a capture back where the user sees it, not mid-classification.
    before["inbox_state"] = "captured"
    for field, value in task_patch(
        current_due=todo.due_date,
        deadline=deadline_for(todo, zone),
        zone=zone,
        original=todo.title,
        current_description=todo.description,
    ).items():
        setattr(todo, field, value)
    routing = record_task_move(
        db,
        before=before,
        todo_id=todo.id,
        title=todo.title,
        due_date=todo.due_date,
        origin=origin,
    )
    await db.flush()
    return routing


def is_upcoming(
    deadline: ParsedDeadline, zone: Zone, now: datetime | None = None
) -> bool:
    today = (now or datetime.now(timezone.utc)).astimezone(as_zone(zone)).date()
    return deadline.local_date >= today


async def route_on_capture(
    db: AsyncSession, todo: Todo, *, zone: Zone, ai_available: bool
) -> InboxRouting | None:
    """File a new capture at once when its title names one upcoming date.

    Otherwise the classifier decides in the background when there is one, and
    the capture waits in the Inbox when there is not.
    """
    deadline = deadline_for(todo, zone)
    if deadline is not None and is_upcoming(deadline, zone):
        # A clock time may mean an appointment rather than a deadline; when a
        # classifier is there, it tells the two apart (``_route_for``).
        if deadline.local_time is None or not ai_available:
            return await file_as_task(db, todo, origin="auto", zone=zone)
    todo.inbox_state = "classifying" if ai_available else "captured"
    await db.flush()
    return None


# Agent runs in these states are history; a run in any other is still going.
_FINISHED_RUN_STATES = ("completed", "failed", "cancelled")


async def _require_plain_capture(
    db: AsyncSession, todo: Todo, what: str = "a note"
) -> None:
    """A note (or an event) has no steps, links, files, comments or live runs to carry over.

    Finished runs and plan drafts are only history (an Inbox that used to plan
    by itself left one on many captures); they are detached, and undo puts
    them back.
    """
    if todo.status in {TaskStatus.COMPLETED, TaskStatus.CANCELLED}:
        raise _cannot_move(f"A finished task cannot become {what}", todo_id=todo.id)
    if todo.parent_id is not None:
        raise _cannot_move(
            f"A step of another task cannot become {what}", todo_id=todo.id
        )
    checks = (
        (select(Todo.id).where(Todo.parent_id == todo.id), "it has steps"),
        (
            select(Project.id).where(Project.root_task_id == todo.id),
            "it is a project's root",
        ),
        (
            select(TaskRelationship.id).where(
                or_(
                    TaskRelationship.source_task_id == todo.id,
                    TaskRelationship.target_task_id == todo.id,
                )
            ),
            "it is linked to other tasks",
        ),
        (
            select(TaskComment.id).where(TaskComment.todo_id == todo.id),
            "it has comments",
        ),
        (select(Attachment.id).where(Attachment.todo_id == todo.id), "it has files"),
        (
            select(AgentTask.id).where(
                AgentTask.todo_id == todo.id,
                AgentTask.status.not_in(_FINISHED_RUN_STATES),
            ),
            "an agent run on it is still going",
        ),
        (select(Artifact.id).where(Artifact.task_id == todo.id), "it has run results"),
    )
    for query, reason in checks:
        if (await db.execute(query.limit(1))).first() is not None:
            raise _cannot_move(
                f"This task cannot become {what}: {reason}",
                todo_id=todo.id,
                reason=reason,
            )


async def _detach_history(db: AsyncSession, todo_id: str) -> dict[str, list[str]]:
    """Unlink finished runs and plan drafts from a task about to be removed."""
    run_ids = list(
        (
            await db.execute(select(AgentTask.id).where(AgentTask.todo_id == todo_id))
        ).scalars()
    )
    proposal_ids = list(
        (
            await db.execute(
                select(PlanProposal.id).where(PlanProposal.root_task_id == todo_id)
            )
        ).scalars()
    )
    if run_ids:
        await db.execute(
            update(AgentTask).where(AgentTask.id.in_(run_ids)).values(todo_id=None)
        )
    if proposal_ids:
        await db.execute(
            update(PlanProposal)
            .where(PlanProposal.id.in_(proposal_ids))
            .values(root_task_id=None)
        )
    return {"agent_task_ids": run_ids, "plan_proposal_ids": proposal_ids}


async def _reattach_history(db: AsyncSession, todo_id: str, before: dict) -> None:
    run_ids = before.get("agent_task_ids") or []
    proposal_ids = before.get("plan_proposal_ids") or []
    if run_ids:
        await db.execute(
            update(AgentTask)
            .where(AgentTask.id.in_(run_ids), AgentTask.todo_id.is_(None))
            .values(todo_id=todo_id)
        )
    if proposal_ids:
        await db.execute(
            update(PlanProposal)
            .where(
                PlanProposal.id.in_(proposal_ids), PlanProposal.root_task_id.is_(None)
            )
            .values(root_task_id=todo_id)
        )


def _note_content(todo: Todo) -> str:
    if todo.description and todo.description.strip():
        return f"{todo.title}\n\n{todo.description.strip()}"
    return todo.title


async def task_to_note(
    db: AsyncSession,
    todo: Todo,
    *,
    origin: str,
    kind_confidence: float | None = None,
) -> InboxRouting:
    await _require_plain_capture(db, todo)
    # Before the history is detached: closing finds the plans by their root task.
    await review_item_service.close_task_plan_reviews(db, [todo.id])
    before = _todo_row(todo)
    before.update(await _detach_history(db, todo.id))
    note = Note(content=_note_content(todo), project_id=todo.project_id)
    db.add(note)
    await db.delete(todo)
    await db.flush()
    return _record(
        db,
        origin=origin,
        kind="note",
        kind_confidence=kind_confidence,
        todo_id=str(before["id"]),
        note_id=note.id,
        title=note.content.split("\n", 1)[0],
        original_title=str(before["title"]),
        before_json=json.dumps({"type": "todo_row", **before}),
    )


async def note_to_task(
    db: AsyncSession, note: Note, *, origin: str, zone: Zone
) -> InboxRouting:
    before = _note_row(note)
    first, _, rest = note.content.partition("\n")
    title = first.strip()[:_TITLE_LIMIT] or note.content.strip()[:_TITLE_LIMIT]
    todo = Todo(
        title=title,
        description=rest.strip() or None,
        project_id=note.project_id,
        inbox_state="none",
        created_at=note.created_at,
    )
    deadline = parse_deadline(title, capture_day(note.created_at, zone))
    for field, value in task_patch(
        current_due=None, deadline=deadline, zone=zone
    ).items():
        setattr(todo, field, value)
    db.add(todo)
    await db.delete(note)
    await db.flush()
    return _record(
        db,
        origin=origin,
        kind="task",
        todo_id=todo.id,
        note_id=str(before["id"]),
        title=todo.title,
        original_title=title,
        due_date=todo.due_date,
        before_json=json.dumps({"type": "note_row", **before}),
    )


def event_window(
    start: datetime, end: datetime | None, zone: Zone
) -> tuple[datetime, datetime | None, bool]:
    """When an event made from a task runs: a clock time lasts an hour unless
    an end is given; the end of a day (a deadline with no clock) is all day."""
    local = start.astimezone(as_zone(zone))
    if (local.hour, local.minute) == (23, 59) and end is None:
        day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        return day_start.astimezone(timezone.utc), None, True
    return start, end or start + DEFAULT_EVENT_LENGTH, False


async def task_to_event(
    db: AsyncSession,
    todo: Todo,
    *,
    origin: str,
    zone: Zone,
    start: datetime | None = None,
    end: datetime | None = None,
    location: str | None = None,
    title: str | None = None,
    kind_confidence: float | None = None,
) -> InboxRouting:
    """Replace a task with a calendar event at ``start`` (its deadline when
    none is given). The task's text stays on the event; undo brings the task
    back under its old id."""
    moment = start or todo.due_date
    if moment is None:
        raise _cannot_move("An event needs a date or time", todo_id=todo.id)
    await _require_plain_capture(db, todo, "an event")
    await review_item_service.close_task_plan_reviews(db, [todo.id])
    before = _todo_row(todo)
    before.update(await _detach_history(db, todo.id))
    starts, ends, all_day = event_window(
        moment.replace(tzinfo=moment.tzinfo or timezone.utc), end, zone
    )
    heading = (title or todo.title).strip()[:_TITLE_LIMIT] or todo.title[:_TITLE_LIMIT]
    # Nothing typed is lost: a title cut from the text keeps the text below it.
    description = todo.description
    if not (description or "").strip() and heading != todo.title.strip():
        description = todo.title
    event = await calendar_service.create_event(
        db,
        title=heading,
        description=description,
        project_id=todo.project_id,
        start_time=starts,
        end_time=ends,
        location=location,
        is_all_day=all_day,
    )
    await db.delete(todo)
    await db.flush()
    return _record(
        db,
        origin=origin,
        kind="event",
        kind_confidence=kind_confidence,
        todo_id=str(before["id"]),
        event_id=event.id,
        title=event.title,
        original_title=str(before["title"]),
        due_date=event.start_time,
        before_json=json.dumps({"type": "todo_row", **before}),
    )


async def event_to_task(
    db: AsyncSession, event: Event, *, origin: str
) -> InboxRouting:
    """Replace an event with a task due when the event started; undo restores
    the event under its old id."""
    before = _event_row(event)
    start = event.start_time.replace(tzinfo=event.start_time.tzinfo or timezone.utc)
    if event.is_all_day:
        start = start + timedelta(hours=23, minutes=59, seconds=59)
    todo = Todo(
        title=event.title[:_TITLE_LIMIT],
        description=event.description,
        project_id=event.project_id,
        due_date=start,
        inbox_state="none",
        created_at=event.created_at,
    )
    db.add(todo)
    await calendar_service.delete_event(db, event.id)
    await db.flush()
    return _record(
        db,
        origin=origin,
        kind="task",
        todo_id=todo.id,
        event_id=str(before["id"]),
        title=todo.title,
        original_title=event.title,
        due_date=todo.due_date,
        before_json=json.dumps({"type": "event_row", **before}),
    )


def _produced_by(routing: InboxRouting) -> str | None:
    """The id of the item a move made: a task, a note or an event."""
    if routing.kind == "task":
        return routing.todo_id
    if routing.kind == "note":
        return routing.note_id
    return routing.event_id


async def _later_move(db: AsyncSession, routing: InboxRouting) -> InboxRouting | None:
    """A move made after *routing* to the item *routing* produced."""
    if routing.kind == "task":
        produced = InboxRouting.todo_id == routing.todo_id
    elif routing.kind == "note":
        produced = InboxRouting.note_id == routing.note_id
    else:
        produced = InboxRouting.event_id == routing.event_id
    return (
        await db.execute(
            select(InboxRouting)
            .where(
                produced,
                InboxRouting.id != routing.id,
                InboxRouting.reverted_at.is_(None),
                InboxRouting.created_at >= routing.created_at,
            )
            .limit(1)
        )
    ).scalar_one_or_none()


def _restore_todo(row: dict[str, object]) -> Todo:
    values = {field: row.get(field) for field in _ROW_FIELDS}
    values["due_date"] = _decode_time(values["due_date"])
    created = _decode_time(row.get("created_at"))
    todo = Todo(**values)
    if created is not None:
        todo.created_at = created
    return todo


async def undo(db: AsyncSession, routing_id: str) -> InboxRouting:
    """Put the item back as it was before this move."""
    routing = await db.get(InboxRouting, routing_id)
    if routing is None:
        raise NotFoundError("Inbox move not found")
    if routing.reverted_at is not None:
        return routing
    if await _later_move(db, routing) is not None:
        raise _cannot_move("Undo the later move first", routing_id=routing.id)
    before = json.loads(routing.before_json)
    kind = before.pop("type")
    if kind == "todo_fields":
        todo = await db.get(Todo, routing.todo_id)
        if todo is None:
            raise _cannot_move("The task is gone", routing_id=routing.id)
        for field in _TASK_FIELDS:
            value = before.get(field)
            setattr(todo, field, _decode_time(value) if field == "due_date" else value)
    elif kind == "todo_row":
        if routing.kind == "event":
            event = await db.get(Event, routing.event_id)
            if event is None:
                raise _cannot_move("The event is gone", routing_id=routing.id)
        else:
            note = await db.get(Note, routing.note_id)
            if note is None:
                raise _cannot_move("The note is gone", routing_id=routing.id)
        if await db.get(Todo, before["id"]) is not None:
            raise _cannot_move("The task already exists", routing_id=routing.id)
        if routing.kind == "event":
            await calendar_service.delete_event(db, routing.event_id)
        else:
            await db.delete(note)
        await db.flush()
        if (
            before.get("project_id")
            and await db.get(Project, before["project_id"]) is None
        ):
            before["project_id"] = None
        db.add(_restore_todo(before))
        await db.flush()
        await _reattach_history(db, str(before["id"]), before)
    elif kind == "event_row":
        todo = await db.get(Todo, routing.todo_id)
        if todo is None:
            raise _cannot_move("The task is gone", routing_id=routing.id)
        await _require_plain_capture(db, todo, "an event again")
        if await db.get(Event, before["id"]) is not None:
            raise _cannot_move("The event already exists", routing_id=routing.id)
        await db.delete(todo)
        await db.flush()
        project_id = before.get("project_id")
        if project_id and await db.get(Project, project_id) is None:
            project_id = None
        event = Event(
            id=before["id"],
            title=before["title"],
            description=before.get("description"),
            project_id=project_id,
            start_time=_decode_time(before["start_time"]),
            end_time=_decode_time(before.get("end_time")),
            location=before.get("location"),
            is_all_day=bool(before.get("is_all_day")),
            tags=before.get("tags"),
        )
        created = _decode_time(before.get("created_at"))
        if created is not None:
            event.created_at = created
        db.add(event)
    else:
        todo = await db.get(Todo, routing.todo_id)
        if todo is None:
            raise _cannot_move("The task is gone", routing_id=routing.id)
        await _require_plain_capture(db, todo)
        if await db.get(Note, before["id"]) is not None:
            raise _cannot_move("The note already exists", routing_id=routing.id)
        await db.delete(todo)
        await db.flush()
        project_id = before.get("project_id")
        if project_id and await db.get(Project, project_id) is None:
            project_id = None
        note = Note(
            id=before["id"],
            content=before["content"],
            project_id=project_id,
            idempotency_key=before.get("idempotency_key"),
        )
        created = _decode_time(before.get("created_at"))
        if created is not None:
            note.created_at = created
        db.add(note)
    routing.reverted_at = datetime.now(timezone.utc)
    await db.flush()
    return routing


async def _unacknowledged(db: AsyncSession, now: datetime | None) -> list[InboxRouting]:
    since = (now or datetime.now(timezone.utc)) - RECENT_WINDOW
    return list(
        (
            await db.execute(
                select(InboxRouting)
                .where(
                    InboxRouting.created_at >= since,
                    InboxRouting.acknowledged_at.is_(None),
                    InboxRouting.reverted_at.is_(None),
                )
                .order_by(InboxRouting.created_at.desc(), InboxRouting.id.desc())
                .limit(100)
            )
        ).scalars()
    )


async def recent(db: AsyncSession, now: datetime | None = None) -> list[InboxRouting]:
    """Moves from the last day the user has not cleared, newest first.

    One line per item: a move made later to the same task or note (filed
    again, or turned into a note and back) stands for the ones before it.
    """
    seen: set[str] = set()
    latest: list[InboxRouting] = []
    for row in await _unacknowledged(db, now):
        if _produced_by(row) not in seen:
            latest.append(row)
        seen.update(
            item for item in (row.todo_id, row.note_id, row.event_id) if item
        )
    return latest


async def acknowledge(db: AsyncSession, now: datetime | None = None) -> int:
    rows = await _unacknowledged(db, now)
    stamp = now or datetime.now(timezone.utc)
    for row in rows:
        row.acknowledged_at = stamp
    await db.flush()
    return len(rows)


async def user_choices(db: AsyncSession, limit: int = 8) -> list[tuple[str, str]]:
    """The user's own recent moves, as (title, kind), for the classifier to follow."""
    rows = (
        await db.execute(
            select(InboxRouting.original_title, InboxRouting.kind)
            .where(InboxRouting.origin == "user", InboxRouting.reverted_at.is_(None))
            .order_by(InboxRouting.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [(title, kind) for title, kind in rows]
