from datetime import date

from pydantic import BaseModel
from schemas._utc import UtcDatetime

from schemas.calendar import EventResponse
from schemas.todo import TodoResponse


class TodayResponse(BaseModel):
    today_tasks: list[TodoResponse]
    overdue_tasks: list[TodoResponse]
    today_events: list[EventResponse]
    needs_review: list[TodoResponse] = []
    # Active tasks with no due date at all — nothing routes them here on its
    # own, so without this they simply never appear on Today.
    needs_date_tasks: list[TodoResponse] = []
    inbox_count: int
    greeting: str
    date: date


class TodaySuggestion(BaseModel):
    """Work a calendar event, or a free stretch of time, calls for."""

    id: str
    # prepare_exam | submit | prepare_talk | prepare_meeting | meeting_notes
    # | link_project | time_block
    kind: str
    # pending | accepted (shown for a day, so it can be undone)
    status: str
    # Added without asking; "Undo" takes it back.
    auto_added: bool
    title: str
    event_title: str | None = None
    event_start: UtcDatetime | None = None
    due_at: UtcDatetime | None = None
    block_start: UtcDatetime | None = None
    block_end: UtcDatetime | None = None
    todo_id: str | None = None
    note_id: str | None = None
    project_id: str | None = None


class TodaySuggestionList(BaseModel):
    suggestions: list[TodaySuggestion]
    # Exams and deadlines are added without asking.
    auto_add: bool


class TodaySuggestionSettings(BaseModel):
    auto_add: bool
