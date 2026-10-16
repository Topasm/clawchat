"""Suggest the work an upcoming calendar event calls for.

After each calendar sync, the next two weeks of imported events are read by
title: an exam wants a study task the day before, a deadline a task on the
day, a talk its slides, a meeting a progress note, a finished meeting its
minutes, a weekly class its project. Tasks with a deadline are offered a free
stretch of time to do them in.

A title no rule matches is asked about once, in a batch, to the active AI, and
its answer (even "nothing") is kept by event UID so it is never asked twice.
What the AI finds is only ever suggested.

Only the surest kinds (exams and deadlines) are added without asking, and only
while the user leaves that on; every addition can be undone. Each suggestion
is one row keyed by (kind, event, occurrence), so it is never made twice, and
an event whose suggestions were turned down twice gets no more.
"""

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from domain.project import ProjectStatus
from domain.task import TaskStatus
from exceptions import AIUnavailableError, ConflictError, NotFoundError
from models.calendar_sync import CalendarAccount, CalendarSource
from models.event import Event
from models.event_kind_guess import EventKindGuess
from models.event_suggestion import EventSuggestion
from models.note import Note
from models.project import Project
from models.todo import Todo
from models.user_settings import UserSettings
from services.calendar import calendar_service
from services.calendar.scheduling_service import find_free_slots
from services.notifications import schedule_settings
from services.tasks import todo_service
from utils import parse_json_object
from ws.notifications import DEFAULT_USER_ID, notify_module_data_changed

logger = logging.getLogger(__name__)

HORIZON = timedelta(days=14)
# A meeting's minutes are offered for this long after it ends.
NOTES_WINDOW = timedelta(hours=24)
# Added or undone suggestions stay in the list this long, so they can be undone.
RECENT = timedelta(hours=24)
PRUNE_AFTER = timedelta(days=60)
MAX_PENDING_BLOCKS = 2
DEFAULT_BLOCK_MINUTES = 120
DISMISSALS_TO_STOP = 2
SOURCE_CALENDAR = "calendar"
# Titles sent to the AI in one refresh; the rest wait for the next one.
MAX_AI_TITLES = 30
NO_KIND = "none"
AUTO_ADD_SETTING = "calendar_suggestions_auto_add"

PENDING = "pending"
ACCEPTED = "accepted"
DISMISSED = "dismissed"

PREPARE_EXAM = "prepare_exam"
SUBMIT = "submit"
PREPARE_TALK = "prepare_talk"
PREPARE_MEETING = "prepare_meeting"
MEETING_NOTES = "meeting_notes"
LINK_PROJECT = "link_project"
TIME_BLOCK = "time_block"

TASK_KINDS = (PREPARE_EXAM, SUBMIT, PREPARE_TALK, PREPARE_MEETING)
EVENT_KINDS = (*TASK_KINDS, MEETING_NOTES)
# Sure enough to add first and let the user undo.
AUTO_KINDS = (PREPARE_EXAM, SUBMIT)

_EXAM = re.compile(
    r"시험|퀴즈|중간고사|기말고사|중간\s*평가|기말\s*평가|^중간$|^기말$"
    r"|\bexams?\b|\bquiz(?:zes)?\b|\bmidterms?\b|\bfinal exams?\b|\bfinals\b",
    re.IGNORECASE,
)
_SUBMIT = re.compile(r"제출|마감|\bdue\b|\bdeadline\b|\bsubmi(?:t|ssion)\b", re.IGNORECASE)
_TALK = re.compile(
    r"발표|세미나|디펜스|\bpresentation\b|\btalk\b|\bdefen[cs]e\b|\bpitch\b", re.IGNORECASE
)
_MEETING = re.compile(
    r"면담|미팅|랩미팅|상담|\bmeeting\b|\b1:1\b|\bone[- ]on[- ]one\b", re.IGNORECASE
)
_MINUTES = re.compile(r"회의|면담|미팅|랩미팅|\bmeeting\b|\bsync\b|\bstandup\b", re.IGNORECASE)
_HANGUL = re.compile(r"[가-힣]")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# --- Rules --------------------------------------------------------------------------


def task_kind(title: str, *, is_all_day: bool) -> str | None:
    """The one task an event of this title calls for, if any."""
    if _EXAM.search(title):
        return PREPARE_EXAM
    if is_all_day and _SUBMIT.search(title):
        return SUBMIT
    if _TALK.search(title):
        return PREPARE_TALK
    if _MEETING.search(title):
        return PREPARE_MEETING
    return None


def wants_minutes(title: str) -> bool:
    return bool(_MINUTES.search(title))


def suggestion_title(kind: str, event_title: str, project_name: str | None = None) -> str:
    korean = bool(_HANGUL.search(event_title))
    if kind == PREPARE_EXAM:
        return f"{event_title} 준비" if korean else f"Prepare for {event_title}"
    if kind == SUBMIT:
        return event_title
    if kind == PREPARE_TALK:
        return f"{event_title} 발표 자료 준비" if korean else f"Prepare slides for {event_title}"
    if kind == PREPARE_MEETING:
        return (
            f"{event_title} 전 진행 상황 정리"
            if korean
            else f"Write up progress before {event_title}"
        )
    if kind == MEETING_NOTES:
        return f"{event_title} 회의 내용" if korean else f"Notes from {event_title}"
    if kind == LINK_PROJECT:
        return (
            f"{event_title} 일정을 {project_name}에 연결"
            if korean
            else f"Link {event_title} to {project_name}"
        )
    return event_title


def _event_day(event: Event, zone: tzinfo) -> date:
    start = _utc(event.start_time)
    # All-day events are stored at UTC midnight of their date.
    return start.date() if event.is_all_day else start.astimezone(zone).date()


def _end_of(day: date, zone: tzinfo) -> datetime:
    return datetime.combine(day, time(23, 59), tzinfo=zone).astimezone(timezone.utc)


def due_for(kind: str, event: Event, zone: tzinfo, now: datetime) -> datetime:
    day = _event_day(event, zone)
    days_before = {PREPARE_EXAM: 1, PREPARE_TALK: 2, PREPARE_MEETING: 1}.get(kind, 0)
    due = _end_of(day - timedelta(days=days_before), zone)
    if kind != SUBMIT and due < now:
        # Too late for the day before: still worth doing before it starts.
        due = _utc(event.start_time)
    return due


def _normalize(name: str) -> str:
    return re.sub(r"[\s_\-./]+", "", name).lower()


def _matching_project(title: str, projects: list[Project]) -> Project | None:
    wanted = _normalize(title)
    if len(wanted) < 3:
        return None
    for project in projects:
        name = _normalize(project.title or "")
        if len(name) >= 3 and (name in wanted or wanted in name):
            return project
    return None


# --- Asking the AI ---------------------------------------------------------------

_GUESS_PROMPT = """You sort calendar event titles by the preparation they call for.
For each numbered title, answer with one of:
- prepare_exam: an exam, test or quiz to study for
- submit: something to hand in or a deadline
- prepare_talk: a talk or presentation to prepare slides for
- prepare_meeting: a meeting to bring a progress update to
- none: no preparation needed (meals, travel, classes, social plans, reminders)
Titles may be in any language. When unsure, answer none.
Reply with only a JSON object mapping each number to its answer, e.g. {"1": "none"}."""


def _unasked(
    events: list[Event], guesses: dict[str, EventKindGuess], now: datetime
) -> dict[str, str]:
    """Upcoming titles no rule matches and the AI has not seen, by event UID."""
    wanted: dict[str, str] = {}
    for event in events:
        uid = event.external_uid
        title = (event.title or "").strip()
        if not uid or not title or uid in wanted or _utc(event.start_time) <= now:
            continue
        if task_kind(title, is_all_day=event.is_all_day) or wants_minutes(title):
            continue
        known = guesses.get(uid)
        if known is not None and known.title == title:
            continue
        wanted[uid] = title
        if len(wanted) >= MAX_AI_TITLES:
            break
    return wanted


async def _ask_ai(ai, titles: list[str]) -> list[str] | None:
    """One kind per title, or None when the AI could not be asked."""
    numbered = "\n".join(f"{index}. {title}" for index, title in enumerate(titles, 1))
    try:
        reply = await ai.generate_completion(_GUESS_PROMPT, numbered)
    except AIUnavailableError:
        logger.debug("No AI for calendar titles; trying again on a later sync")
        return None
    except Exception:
        logger.warning("Asking the AI about calendar titles failed", exc_info=True)
        return None
    answers = parse_json_object(reply) or {}
    kinds = []
    for index in range(1, len(titles) + 1):
        answer = answers.get(str(index))
        kinds.append(answer if answer in TASK_KINDS else NO_KIND)
    return kinds


async def _guess_kinds(
    db: AsyncSession, events: list[Event], ai, now: datetime
) -> dict[tuple[str, str], str]:
    """The AI's kind by (event UID, title) for titles the rules miss, asking about new ones."""
    guesses = {row.subject_key: row for row in (await db.execute(select(EventKindGuess))).scalars()}
    wanted = _unasked(events, guesses, now) if ai is not None else {}
    if wanted:
        kinds = await _ask_ai(ai, list(wanted.values()))
        for (uid, title), kind in zip(wanted.items(), kinds or []):
            row = guesses.get(uid)
            if row is None:
                row = EventKindGuess(subject_key=uid, title=title, kind=kind)
                db.add(row)
                guesses[uid] = row
            else:
                row.title, row.kind = title, kind
    return {(uid, row.title): row.kind for uid, row in guesses.items() if row.kind in TASK_KINDS}


# --- Settings -----------------------------------------------------------------------


async def _settings_row(db: AsyncSession) -> UserSettings | None:
    return (
        await db.execute(select(UserSettings).where(UserSettings.user_id == DEFAULT_USER_ID))
    ).scalar_one_or_none()


async def auto_add_enabled(db: AsyncSession) -> bool:
    row = await _settings_row(db)
    if row is None:
        return True
    try:
        value = json.loads(row.settings_json or "{}").get(AUTO_ADD_SETTING)
    except (ValueError, AttributeError):
        return True
    return value if isinstance(value, bool) else True


async def set_auto_add(db: AsyncSession, enabled: bool) -> bool:
    row = await _settings_row(db)
    if row is None:
        row = UserSettings(user_id=DEFAULT_USER_ID, settings_json="{}")
        db.add(row)
    try:
        stored = json.loads(row.settings_json or "{}")
    except ValueError:
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    stored[AUTO_ADD_SETTING] = enabled
    row.settings_json = json.dumps(stored)
    await db.commit()
    return enabled


# --- Refresh ------------------------------------------------------------------------


@dataclass
class _Pass:
    now: datetime
    zone: tzinfo
    auto_add: bool
    rows: dict[tuple[str, str, str], EventSuggestion]
    stopped: set[tuple[str, str]]
    # What the AI said about titles no rule matches, by (event UID, title).
    guessed: dict[tuple[str, str], str]
    changed: bool = False


async def _has_calendar(db: AsyncSession) -> bool:
    return (await db.execute(select(CalendarAccount.id).limit(1))).first() is not None


async def refresh(db: AsyncSession, now: datetime | None = None, ai=None) -> bool:
    """Make the suggestions the calendar calls for now. True when any changed.

    ``ai`` is the active provider, asked about titles the rules miss; without
    one those titles wait for a later refresh.
    """
    if not await _has_calendar(db):
        return False
    current = now or _now()
    zone = (await schedule_settings.load(db)).zone
    rows = {
        (row.kind, row.subject_key, row.occurrence_key): row
        for row in (await db.execute(select(EventSuggestion))).scalars()
    }
    stopped = {
        (kind, subject)
        for kind, subject, count in (
            await db.execute(
                select(
                    EventSuggestion.kind,
                    EventSuggestion.subject_key,
                    func.count(EventSuggestion.id),
                )
                .where(EventSuggestion.status == DISMISSED)
                .group_by(EventSuggestion.kind, EventSuggestion.subject_key)
            )
        ).all()
        if count >= DISMISSALS_TO_STOP
    }
    events = list(
        (
            await db.execute(
                select(Event)
                .join(CalendarSource, CalendarSource.id == Event.calendar_source_id)
                .where(
                    Event.origin == "remote",
                    CalendarSource.suggestions_enabled.is_(True),
                    CalendarSource.import_enabled.is_(True),
                    Event.start_time >= current - NOTES_WINDOW - timedelta(days=1),
                    Event.start_time < current + HORIZON,
                )
                .order_by(Event.start_time)
            )
        ).scalars()
    )
    guessed = await _guess_kinds(db, events, ai, current)
    state = _Pass(current, zone, await auto_add_enabled(db), rows, stopped, guessed)
    await _event_suggestions(db, state, events)
    await _project_links(db, state, events)
    await _apply_project_links(db)
    await _time_blocks(db, state)
    await _prune(db, state)
    await db.commit()
    if state.changed:
        await notify_module_data_changed("suggestions")
        await notify_module_data_changed("todos")
    return state.changed


async def _event_suggestions(db: AsyncSession, state: _Pass, events: list[Event]) -> None:
    linked = {
        row
        for row in (
            await db.execute(
                select(Todo.source_id).where(
                    Todo.source == SOURCE_CALENDAR, Todo.source_id.isnot(None)
                )
            )
        ).scalars()
    }
    seen: set[tuple[str, str, str]] = set()
    for event in events:
        uid = event.external_uid
        if not uid:
            continue
        occurrence = event.external_recurrence_id or ""
        start = _utc(event.start_time)
        end = _utc(event.end_time) or start
        wanted: list[str] = []
        kind = task_kind(event.title, is_all_day=event.is_all_day)
        from_ai = False
        if kind is None:
            kind = state.guessed.get((uid, (event.title or "").strip()))
            from_ai = kind is not None
        if kind is not None and start > state.now and event.id not in linked:
            wanted.append(kind)
        if (
            wants_minutes(event.title)
            and not event.is_all_day
            and end <= state.now < end + NOTES_WINDOW
        ):
            wanted.append(MEETING_NOTES)
        for kind in wanted:
            key = (kind, uid, occurrence)
            seen.add(key)
            row = state.rows.get(key)
            if row is not None:
                if row.status == PENDING:
                    row.event_id = event.id
                    row.event_title = event.title
                    row.event_start = start
                    if kind in TASK_KINDS:
                        row.due_at = due_for(kind, event, state.zone, state.now)
                    row.title = suggestion_title(kind, event.title)
                continue
            if (kind, uid) in state.stopped:
                continue
            row = EventSuggestion(
                kind=kind,
                subject_key=uid,
                occurrence_key=occurrence,
                title=suggestion_title(kind, event.title),
                event_id=event.id,
                event_title=event.title,
                event_start=start,
                due_at=due_for(kind, event, state.zone, state.now) if kind in TASK_KINDS else None,
                project_id=event.project_id,
                status=PENDING,
            )
            db.add(row)
            state.rows[key] = row
            state.changed = True
            # What the AI found is only suggested, never added without asking.
            if state.auto_add and kind in AUTO_KINDS and not from_ai:
                await db.flush()
                await _accept(db, row, state.now)
                row.auto_added = True

    # A pending suggestion whose event moved away or was deleted goes with it.
    for key, row in list(state.rows.items()):
        if row.kind in EVENT_KINDS and row.status == PENDING and key not in seen:
            await db.delete(row)
            del state.rows[key]
            state.changed = True


async def _project_links(db: AsyncSession, state: _Pass, events: list[Event]) -> None:
    """A class that repeats, named like a project, is offered to that project."""
    projects = list(
        (
            await db.execute(
                select(Project).where(
                    Project.status.in_([ProjectStatus.PLANNED, ProjectStatus.ACTIVE])
                )
            )
        ).scalars()
    )
    if not projects:
        return
    series: dict[str, Event] = {}
    for event in events:
        if event.external_uid and event.external_recurrence_id and event.project_id is None:
            series.setdefault(event.external_uid, event)
    for uid, event in series.items():
        key = (LINK_PROJECT, uid, "")
        if key in state.rows or (LINK_PROJECT, uid) in state.stopped:
            continue
        project = _matching_project(event.title, projects)
        if project is None:
            continue
        row = EventSuggestion(
            kind=LINK_PROJECT,
            subject_key=uid,
            occurrence_key="",
            title=suggestion_title(LINK_PROJECT, event.title, project.title),
            event_id=event.id,
            event_title=event.title,
            event_start=_utc(event.start_time),
            project_id=project.id,
            status=PENDING,
        )
        db.add(row)
        state.rows[key] = row
        state.changed = True


async def _apply_project_links(db: AsyncSession) -> None:
    """New occurrences of a linked series join its project too."""
    links = (
        await db.execute(
            select(EventSuggestion.subject_key, EventSuggestion.project_id).where(
                EventSuggestion.kind == LINK_PROJECT,
                EventSuggestion.status == ACCEPTED,
                EventSuggestion.project_id.isnot(None),
            )
        )
    ).all()
    for uid, project_id in links:
        await db.execute(
            update(Event)
            .where(Event.external_uid == uid, Event.project_id.is_(None))
            .values(project_id=project_id)
        )


def _round_up(moment: datetime, minutes: int = 30) -> datetime:
    floor = moment.replace(second=0, microsecond=0)
    extra = (-floor.minute) % minutes
    if extra == 0 and floor == moment:
        return floor
    return floor + timedelta(minutes=extra or minutes)


def _overlaps(start: datetime, end: datetime, taken: list[tuple[datetime, datetime]]):
    return next((t for t in taken if start < t[1] and t[0] < end), None)


async def _find_block(
    db: AsyncSession,
    state: _Pass,
    after: datetime,
    before: datetime,
    minutes: int,
    taken: list[tuple[datetime, datetime]],
) -> tuple[datetime, datetime] | None:
    if before - after < timedelta(minutes=minutes):
        return None
    slots = await find_free_slots(db, after, before, minutes, zone=state.zone)
    length = timedelta(minutes=minutes)
    for slot in slots:
        slot_end = datetime.fromisoformat(slot["end"])
        start = _round_up(datetime.fromisoformat(slot["start"]))
        while start + length <= slot_end:
            clash = _overlaps(start, start + length, taken)
            if clash is None:
                # SQLite keeps no offset: store UTC, whatever zone the slot is in.
                begins = start.astimezone(timezone.utc)
                return begins, begins + length
            start = _round_up(clash[1])
    return None


async def _time_blocks(db: AsyncSession, state: _Pass) -> None:
    """Offer a free stretch before the deadline to tasks that have one coming."""
    for row in list(state.rows.values()):
        if row.kind != TIME_BLOCK or row.status != PENDING:
            continue
        todo = await db.get(Todo, row.todo_id) if row.todo_id else None
        stale = _utc(row.block_start) is None or _utc(row.block_start) <= state.now
        if stale or todo is None or todo.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
            await db.delete(row)
            del state.rows[(row.kind, row.subject_key, row.occurrence_key)]
            state.changed = True

    blocks = [row for row in state.rows.values() if row.kind == TIME_BLOCK]
    pending = sum(1 for row in blocks if row.status == PENDING)
    if pending >= MAX_PENDING_BLOCKS:
        return
    taken = [
        (_utc(row.block_start), _utc(row.block_end))
        for row in blocks
        if row.status != DISMISSED and row.block_start and row.block_end
    ]
    by_todo: dict[str, list[EventSuggestion]] = {}
    for row in blocks:
        by_todo.setdefault(row.subject_key, []).append(row)
    exam_tasks = {
        row.todo_id
        for row in state.rows.values()
        if row.kind == PREPARE_EXAM and row.status == ACCEPTED and row.todo_id
    }
    earliest = _round_up(state.now + timedelta(hours=1), 60)
    todos = (
        await db.execute(
            select(Todo)
            .where(
                Todo.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
                Todo.inbox_state == "none",
                Todo.due_date.isnot(None),
                Todo.due_date > earliest,
                Todo.due_date <= state.now + HORIZON,
            )
            .order_by(Todo.due_date)
        )
    ).scalars()
    for todo in todos:
        if pending >= MAX_PENDING_BLOCKS:
            break
        subject = f"todo:{todo.id}"
        existing = by_todo.get(subject, [])
        if any(row.status == DISMISSED for row in existing):
            continue
        wanted = 2 if todo.id in exam_tasks else 1
        if len(existing) >= wanted:
            continue
        minutes = max(30, min(todo.estimated_minutes or DEFAULT_BLOCK_MINUTES, 180))
        after = max(
            [earliest, *(_utc(row.block_end) for row in existing if row.block_end)]
        )
        found = await _find_block(db, state, after, _utc(todo.due_date), minutes, taken)
        if found is None:
            continue
        row = EventSuggestion(
            kind=TIME_BLOCK,
            subject_key=subject,
            occurrence_key=str(len(existing)),
            title=todo.title,
            todo_id=todo.id,
            due_at=_utc(todo.due_date),
            block_start=found[0],
            block_end=found[1],
            project_id=todo.project_id,
            status=PENDING,
        )
        db.add(row)
        state.rows[(TIME_BLOCK, subject, row.occurrence_key)] = row
        taken.append(found)
        pending += 1
        state.changed = True


async def _prune(db: AsyncSession, state: _Pass) -> None:
    """Forget old answers; a link to a project is kept for good."""
    await db.execute(
        delete(EventKindGuess).where(
            EventKindGuess.subject_key.not_in(
                select(Event.external_uid).where(Event.external_uid.isnot(None))
            )
        )
    )
    await db.execute(
        delete(EventSuggestion).where(
            EventSuggestion.kind != LINK_PROJECT,
            EventSuggestion.status != PENDING,
            func.coalesce(
                EventSuggestion.event_start,
                EventSuggestion.block_start,
                EventSuggestion.created_at,
            )
            < state.now - PRUNE_AFTER,
        )
    )


# --- The list and its buttons ---------------------------------------------------------


async def visible(db: AsyncSession, now: datetime | None = None) -> list[EventSuggestion]:
    """Waiting suggestions, plus the ones added in the last day (so they can be undone)."""
    current = now or _now()
    rows = (
        await db.execute(
            select(EventSuggestion).where(
                (EventSuggestion.status == PENDING)
                | (
                    (EventSuggestion.status == ACCEPTED)
                    & (EventSuggestion.resolved_at >= current - RECENT)
                )
            )
        )
    ).scalars()

    def order(row: EventSuggestion):
        moment = _utc(row.block_start or row.due_at or row.event_start) or current
        return (row.status != ACCEPTED, moment)

    return sorted(rows, key=order)


async def require(db: AsyncSession, suggestion_id: str) -> EventSuggestion:
    row = await db.get(EventSuggestion, suggestion_id)
    if row is None:
        raise NotFoundError("Suggestion not found")
    return row


async def _accept(db: AsyncSession, row: EventSuggestion, now: datetime) -> list[str]:
    """Do what the suggestion says. Returns the data modules that changed."""
    event = await db.get(Event, row.event_id) if row.event_id else None
    project_id = (event.project_id if event else None) or row.project_id
    if project_id is not None and await db.get(Project, project_id) is None:
        project_id = None
    modules: list[str]
    if row.kind in TASK_KINDS:
        todo = await todo_service.create_todo(
            db,
            title=row.title,
            due_date=row.due_at,
            project_id=project_id,
            source=SOURCE_CALENDAR,
            source_id=row.event_id,
        )
        row.todo_id = todo.id
        modules = ["todos"]
    elif row.kind == MEETING_NOTES:
        note = Note(content=f"# {row.title}\n\n", project_id=project_id)
        db.add(note)
        await db.flush()
        row.note_id = note.id
        modules = ["notes"]
    elif row.kind == LINK_PROJECT:
        if row.project_id is None or await db.get(Project, row.project_id) is None:
            raise ConflictError("That project no longer exists")
        await db.execute(
            update(Event)
            .where(Event.external_uid == row.subject_key, Event.project_id.is_(None))
            .values(project_id=row.project_id)
        )
        modules = ["events"]
    elif row.kind == TIME_BLOCK:
        todo = await db.get(Todo, row.todo_id) if row.todo_id else None
        if todo is None or row.block_start is None:
            raise ConflictError("That task is gone")
        created = await calendar_service.create_event(
            db,
            title=todo.title,
            project_id=todo.project_id,
            start_time=_utc(row.block_start),
            end_time=_utc(row.block_end),
        )
        row.created_event_id = created.id
        modules = ["events"]
    else:
        raise ConflictError("This suggestion cannot be added")
    row.status = ACCEPTED
    row.resolved_at = now
    return modules


async def accept(db: AsyncSession, suggestion_id: str) -> EventSuggestion:
    row = await require(db, suggestion_id)
    if row.status != PENDING:
        raise ConflictError("This suggestion was already answered")
    modules = await _accept(db, row, _now())
    await db.commit()
    for module in (*modules, "suggestions"):
        await notify_module_data_changed(module)
    return row


async def dismiss(db: AsyncSession, suggestion_id: str) -> EventSuggestion:
    row = await require(db, suggestion_id)
    if row.status != PENDING:
        raise ConflictError("This suggestion was already answered")
    row.status = DISMISSED
    row.resolved_at = _now()
    await db.commit()
    await notify_module_data_changed("suggestions")
    return row


async def undo(db: AsyncSession, suggestion_id: str) -> EventSuggestion:
    """Take back what adding it did; it then counts as turned down."""
    row = await require(db, suggestion_id)
    if row.status != ACCEPTED:
        raise ConflictError("Only an added suggestion can be undone")
    modules: list[str] = ["suggestions"]
    if row.kind in TASK_KINDS and row.todo_id:
        if await db.get(Todo, row.todo_id) is not None:
            await todo_service.delete_todo(db, row.todo_id)
            modules.append("todos")
    elif row.kind == MEETING_NOTES and row.note_id:
        note = await db.get(Note, row.note_id)
        if note is not None:
            await db.delete(note)
            modules.append("notes")
    elif row.kind == LINK_PROJECT and row.project_id:
        await db.execute(
            update(Event)
            .where(Event.external_uid == row.subject_key, Event.project_id == row.project_id)
            .values(project_id=None)
        )
        modules.append("events")
    elif row.kind == TIME_BLOCK and row.created_event_id:
        if await db.get(Event, row.created_event_id) is not None:
            await calendar_service.delete_event(db, row.created_event_id)
            modules.append("events")
    row.status = DISMISSED
    row.resolved_at = _now()
    await db.commit()
    for module in modules:
        await notify_module_data_changed(module)
    return row
