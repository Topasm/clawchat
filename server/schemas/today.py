from datetime import date

from pydantic import BaseModel

from schemas.calendar import EventResponse
from schemas.todo import TodoResponse


class TodayResponse(BaseModel):
    today_tasks: list[TodoResponse]
    overdue_tasks: list[TodoResponse]
    today_events: list[EventResponse]
    needs_review: list[TodoResponse] = []
    inbox_count: int
    greeting: str
    date: date
