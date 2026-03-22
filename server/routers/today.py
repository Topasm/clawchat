from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from models.event import Event
from models.todo import Todo
from schemas.calendar import EventResponse
from schemas.today import TodayResponse
from schemas.todo import TodoResponse
from services.briefing_service import generate_briefing
from utils import deserialize_tags
from utils.inbox_display import get_next_action

router = APIRouter(tags=["today"])


def _get_greeting() -> str:
    hour = datetime.now().hour
    if hour < 12:
        return "Good morning"
    if hour < 17:
        return "Good afternoon"
    return "Good evening"


def _todo_to_response(todo: Todo) -> TodoResponse:
    resp = TodoResponse.model_validate(todo)
    if todo.tags:
        resp.tags = deserialize_tags(todo.tags)
    resp.next_action = get_next_action(
        todo.inbox_state or "none", todo.status or "pending"
    )
    if todo.source == "obsidian_project":
        resp.sync_status = "synced"
    elif todo.source and todo.source.startswith("obsidian"):
        resp.sync_status = "linked"
    if todo.source_id:
        resp.project_label = (
            todo.source_id.replace("_", " ").replace("-", " ").strip().title()
        )
    return resp


def _event_to_response(event: Event) -> EventResponse:
    resp = EventResponse.model_validate(event)
    if event.tags:
        resp.tags = deserialize_tags(event.tags)
    return resp


@router.get("/briefing")
async def get_briefing(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    ai_service = request.app.state.ai_service
    result = await generate_briefing(db, ai_service)
    return {"summary": result["summary"], "stats": result["stats"], "date": str(date.today())}


@router.get("", response_model=TodayResponse)
async def get_today(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    today = date.today()
    today_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    today_end = datetime.combine(today, time.max, tzinfo=timezone.utc)

    # Today's tasks: due today and not completed/cancelled
    today_tasks_q = (
        select(Todo)
        .where(
            Todo.due_date >= today_start,
            Todo.due_date <= today_end,
            Todo.status.notin_(["completed", "cancelled"]),
        )
        .order_by(Todo.created_at.asc())
    )
    today_tasks = (await db.execute(today_tasks_q)).scalars().all()

    # Also include in-progress tasks not due today
    in_progress_q = select(Todo).where(
        Todo.status == "in_progress",
        or_(
            Todo.due_date == None,  # noqa: E711
            Todo.due_date < today_start,
            Todo.due_date > today_end,
        ),
    )
    in_progress = (await db.execute(in_progress_q)).scalars().all()
    all_today = list(today_tasks) + list(in_progress)

    # Overdue tasks: due before today, still pending/in_progress
    overdue_q = (
        select(Todo)
        .where(
            Todo.due_date < today_start,
            Todo.status.in_(["pending", "in_progress"]),
        )
        .order_by(Todo.due_date.asc())
    )
    overdue_tasks = (await db.execute(overdue_q)).scalars().all()

    # Today's events
    events_q = (
        select(Event)
        .where(Event.start_time >= today_start, Event.start_time <= today_end)
        .order_by(Event.start_time.asc())
    )
    today_events = (await db.execute(events_q)).scalars().all()

    # Inbox count: no due_date, pending
    inbox_q = select(func.count(Todo.id)).where(
        Todo.due_date == None,  # noqa: E711
        Todo.status == "pending",
    )
    inbox_count = (await db.execute(inbox_q)).scalar() or 0

    # Needs review: plan_ready or captured items (limit 5)
    needs_review_q = (
        select(Todo)
        .where(Todo.inbox_state.in_(["plan_ready", "captured"]))
        .order_by(Todo.updated_at.desc())
        .limit(5)
    )
    needs_review_todos = (await db.execute(needs_review_q)).scalars().all()

    return TodayResponse(
        today_tasks=[_todo_to_response(t) for t in all_today],
        overdue_tasks=[_todo_to_response(t) for t in overdue_tasks],
        today_events=[_event_to_response(e) for e in today_events],
        needs_review=[_todo_to_response(t) for t in needs_review_todos],
        inbox_count=inbox_count,
        greeting=_get_greeting(),
        date=today,
    )
