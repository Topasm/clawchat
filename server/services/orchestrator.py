"""Orchestrator service: routes classified intents to the appropriate module services.

The orchestrator sits between the chat router and the individual CRUD services.
When a user sends a message, the intent classifier determines what the user wants,
and the orchestrator dispatches the request accordingly.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from models.todo import Todo
from models.event import Event
from models.memo import Memo
from schemas.todo import TodoCreate, TodoUpdate
from schemas.calendar import EventCreate, EventUpdate
from schemas.memo import MemoCreate, MemoUpdate
from services import todo_service, calendar_service, memo_service
from services.search_service import search as search_items

logger = logging.getLogger(__name__)


class OrchestratorResult:
    """Container for the result of intent processing."""

    def __init__(
        self,
        intent: str,
        response_text: str,
        action_card: Optional[dict[str, Any]] = None,
        should_stream: bool = False,
    ) -> None:
        self.intent = intent
        self.response_text = response_text
        self.action_card = action_card
        self.should_stream = should_stream


class Orchestrator:
    """Routes classified intents to the appropriate service layer."""

    def process_intent(
        self,
        db: Session,
        intent: str,
        entities: dict[str, Any],
        user_message: str,
    ) -> OrchestratorResult:
        """Process a classified intent and return an OrchestratorResult.

        For ``general_chat``, sets ``should_stream=True`` so the chat router
        knows to stream the AI response.  For CRUD intents, executes the
        action and returns a formatted response with an optional action card.
        """
        handler = self._get_handler(intent)
        if handler is None:
            return OrchestratorResult(
                intent=intent,
                response_text="",
                should_stream=True,
            )

        try:
            return handler(db, entities, user_message)
        except Exception:
            logger.exception("Error processing intent %s", intent)
            return OrchestratorResult(
                intent=intent,
                response_text=f"I encountered an error while trying to handle your request. Please try again.",
            )

    def _get_handler(self, intent: str):
        """Map an intent string to its handler method."""
        handlers = {
            "general_chat": None,  # None signals streaming
            "create_todo": self._handle_create_todo,
            "query_todos": self._handle_query_todos,
            "update_todo": self._handle_update_todo,
            "delete_todo": self._handle_delete_todo,
            "complete_todo": self._handle_complete_todo,
            "create_event": self._handle_create_event,
            "query_events": self._handle_query_events,
            "update_event": self._handle_update_event,
            "delete_event": self._handle_delete_event,
            "create_memo": self._handle_create_memo,
            "query_memos": self._handle_query_memos,
            "update_memo": self._handle_update_memo,
            "delete_memo": self._handle_delete_memo,
            "search": self._handle_search,
            "daily_briefing": self._handle_daily_briefing,
            "delegate_task": None,  # Delegate tasks stream a response
        }
        return handlers.get(intent)

    # ------------------------------------------------------------------
    # Todo handlers
    # ------------------------------------------------------------------

    def _handle_create_todo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        title = entities.get("title", user_message)
        data = TodoCreate(
            title=title,
            description=entities.get("description"),
            priority=entities.get("priority", "medium"),
            due_date=self._parse_datetime(entities.get("due_date")),
            tags=entities.get("tags"),
        )
        todo = todo_service.create_todo(db, data)
        return OrchestratorResult(
            intent="create_todo",
            response_text=f'I\'ve created a new task: "{todo.title}".',
            action_card={
                "card_type": "todo_created",
                "payload": {
                    "id": todo.id,
                    "title": todo.title,
                    "status": todo.status,
                    "priority": todo.priority,
                    "due_date": todo.due_date.isoformat() if todo.due_date else None,
                    "tags": todo.tags,
                },
                "actions": [
                    {"label": "Edit", "action": "edit_todo", "params": {"id": todo.id}},
                    {"label": "Complete", "action": "complete_todo", "params": {"id": todo.id}},
                    {"label": "Delete", "action": "delete_todo", "params": {"id": todo.id}},
                ],
            },
        )

    def _handle_query_todos(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        items, total = todo_service.get_todos(
            db,
            status_filter=entities.get("status"),
            priority=entities.get("priority"),
            due_before=self._parse_datetime(entities.get("due_before")),
            page=1,
            limit=10,
        )
        if not items:
            return OrchestratorResult(
                intent="query_todos",
                response_text="I couldn't find any matching tasks.",
            )

        lines = [f"Found {total} task(s):"]
        for t in items:
            status_icon = "[ ]" if t.status != "completed" else "[x]"
            lines.append(f"- {status_icon} **{t.title}** ({t.priority})")

        return OrchestratorResult(
            intent="query_todos",
            response_text="\n".join(lines),
        )

    def _handle_update_todo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        todo_id = entities.get("id")
        if not todo_id:
            return OrchestratorResult(
                intent="update_todo",
                response_text="I need to know which task to update. Could you specify the task?",
            )

        updates = {}
        for field in ("title", "description", "priority", "status", "due_date", "tags"):
            if field in entities.get("updates", {}):
                updates[field] = entities["updates"][field]
            elif field in entities and field != "id":
                updates[field] = entities[field]

        if not updates:
            return OrchestratorResult(
                intent="update_todo",
                response_text="What would you like to change about this task?",
            )

        if "due_date" in updates and isinstance(updates["due_date"], str):
            updates["due_date"] = self._parse_datetime(updates["due_date"])

        data = TodoUpdate(**updates)
        todo = todo_service.update_todo(db, todo_id, data)
        return OrchestratorResult(
            intent="update_todo",
            response_text=f'Updated task: "{todo.title}".',
            action_card={
                "card_type": "todo_updated",
                "payload": {
                    "id": todo.id,
                    "title": todo.title,
                    "status": todo.status,
                    "priority": todo.priority,
                },
            },
        )

    def _handle_delete_todo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        todo_id = entities.get("id")
        if not todo_id:
            return OrchestratorResult(
                intent="delete_todo",
                response_text="Which task would you like to delete?",
            )
        todo = todo_service.get_todo(db, todo_id)
        title = todo.title
        todo_service.delete_todo(db, todo_id)
        return OrchestratorResult(
            intent="delete_todo",
            response_text=f'Deleted task: "{title}".',
        )

    def _handle_complete_todo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        todo_id = entities.get("id")
        if not todo_id:
            return OrchestratorResult(
                intent="complete_todo",
                response_text="Which task would you like to mark as complete?",
            )

        data = TodoUpdate(status="completed")
        todo = todo_service.update_todo(db, todo_id, data)
        return OrchestratorResult(
            intent="complete_todo",
            response_text=f'Marked "{todo.title}" as completed!',
            action_card={
                "card_type": "todo_completed",
                "payload": {
                    "id": todo.id,
                    "title": todo.title,
                    "status": "completed",
                    "completed_at": todo.completed_at.isoformat() if todo.completed_at else None,
                },
            },
        )

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    def _handle_create_event(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        title = entities.get("title", user_message)
        start_time = self._parse_datetime(entities.get("start_time"))
        if not start_time:
            start_time = datetime.now(timezone.utc)

        data = EventCreate(
            title=title,
            description=entities.get("description"),
            start_time=start_time,
            end_time=self._parse_datetime(entities.get("end_time")),
            location=entities.get("location"),
            is_all_day=entities.get("is_all_day", False),
            reminder_minutes=entities.get("reminder_minutes"),
            tags=entities.get("tags"),
        )
        event = calendar_service.create_event(db, data)
        return OrchestratorResult(
            intent="create_event",
            response_text=f'I\'ve scheduled "{event.title}" for {event.start_time.strftime("%B %d at %I:%M %p")}.',
            action_card={
                "card_type": "event_created",
                "payload": {
                    "id": event.id,
                    "title": event.title,
                    "start_time": event.start_time.isoformat(),
                    "end_time": event.end_time.isoformat() if event.end_time else None,
                    "location": event.location,
                },
                "actions": [
                    {"label": "Edit", "action": "edit_event", "params": {"id": event.id}},
                    {"label": "Delete", "action": "delete_event", "params": {"id": event.id}},
                ],
            },
        )

    def _handle_query_events(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        items, total = calendar_service.get_events(
            db,
            start_after=self._parse_datetime(entities.get("start_after")),
            start_before=self._parse_datetime(entities.get("start_before")),
            page=1,
            limit=10,
        )
        if not items:
            return OrchestratorResult(
                intent="query_events",
                response_text="I couldn't find any matching events.",
            )

        lines = [f"Found {total} event(s):"]
        for e in items:
            time_str = e.start_time.strftime("%b %d, %I:%M %p") if e.start_time else "TBD"
            lines.append(f"- **{e.title}** at {time_str}")

        return OrchestratorResult(
            intent="query_events",
            response_text="\n".join(lines),
        )

    def _handle_update_event(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        event_id = entities.get("id")
        if not event_id:
            return OrchestratorResult(
                intent="update_event",
                response_text="Which event would you like to update?",
            )

        updates = {}
        for field in ("title", "description", "start_time", "end_time", "location", "is_all_day", "reminder_minutes", "tags"):
            if field in entities.get("updates", {}):
                updates[field] = entities["updates"][field]
            elif field in entities and field != "id":
                updates[field] = entities[field]

        for dt_field in ("start_time", "end_time"):
            if dt_field in updates and isinstance(updates[dt_field], str):
                updates[dt_field] = self._parse_datetime(updates[dt_field])

        data = EventUpdate(**updates)
        event = calendar_service.update_event(db, event_id, data)
        return OrchestratorResult(
            intent="update_event",
            response_text=f'Updated event: "{event.title}".',
        )

    def _handle_delete_event(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        event_id = entities.get("id")
        if not event_id:
            return OrchestratorResult(
                intent="delete_event",
                response_text="Which event would you like to delete?",
            )
        event = calendar_service.get_event(db, event_id)
        title = event.title
        calendar_service.delete_event(db, event_id)
        return OrchestratorResult(
            intent="delete_event",
            response_text=f'Deleted event: "{title}".',
        )

    # ------------------------------------------------------------------
    # Memo handlers
    # ------------------------------------------------------------------

    def _handle_create_memo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        content = entities.get("content", user_message)
        title = entities.get("title", content[:50])
        data = MemoCreate(
            title=title,
            content=content,
            tags=entities.get("tags"),
        )
        memo = memo_service.create_memo(db, data)
        return OrchestratorResult(
            intent="create_memo",
            response_text=f"I've saved your memo: \"{memo.title}\".",
            action_card={
                "card_type": "memo_created",
                "payload": {
                    "id": memo.id,
                    "title": memo.title,
                    "content": memo.content[:200],
                },
                "actions": [
                    {"label": "Edit", "action": "edit_memo", "params": {"id": memo.id}},
                    {"label": "Delete", "action": "delete_memo", "params": {"id": memo.id}},
                ],
            },
        )

    def _handle_query_memos(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        items, total = memo_service.get_memos(db, page=1, limit=10)
        if not items:
            return OrchestratorResult(
                intent="query_memos",
                response_text="You don't have any memos yet.",
            )

        lines = [f"Found {total} memo(s):"]
        for m in items:
            preview = m.content[:60] + "..." if len(m.content) > 60 else m.content
            lines.append(f"- **{m.title}**: {preview}")

        return OrchestratorResult(
            intent="query_memos",
            response_text="\n".join(lines),
        )

    def _handle_update_memo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        memo_id = entities.get("id")
        if not memo_id:
            return OrchestratorResult(
                intent="update_memo",
                response_text="Which memo would you like to update?",
            )

        updates = {}
        for field in ("title", "content", "tags"):
            if field in entities.get("updates", {}):
                updates[field] = entities["updates"][field]
            elif field in entities and field != "id":
                updates[field] = entities[field]

        data = MemoUpdate(**updates)
        memo = memo_service.update_memo(db, memo_id, data)
        return OrchestratorResult(
            intent="update_memo",
            response_text=f'Updated memo: "{memo.title}".',
        )

    def _handle_delete_memo(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        memo_id = entities.get("id")
        if not memo_id:
            return OrchestratorResult(
                intent="delete_memo",
                response_text="Which memo would you like to delete?",
            )
        memo = memo_service.get_memo(db, memo_id)
        title = memo.title
        memo_service.delete_memo(db, memo_id)
        return OrchestratorResult(
            intent="delete_memo",
            response_text=f'Deleted memo: "{title}".',
        )

    # ------------------------------------------------------------------
    # Search handler
    # ------------------------------------------------------------------

    def _handle_search(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        query = entities.get("query", user_message)
        types = entities.get("types", ["todos", "events", "memos", "messages"])
        if isinstance(types, str):
            types = [t.strip() for t in types.split(",")]

        items, total = search_items(db, q=query, types=types, page=1, limit=10)

        if not items:
            return OrchestratorResult(
                intent="search",
                response_text=f'No results found for "{query}".',
            )

        lines = [f'Found {total} result(s) for "{query}":']
        for item in items:
            lines.append(f"- [{item['type']}] **{item['title']}**: {item['snippet'][:80]}")

        return OrchestratorResult(
            intent="search",
            response_text="\n".join(lines),
        )

    # ------------------------------------------------------------------
    # Daily briefing handler
    # ------------------------------------------------------------------

    def _handle_daily_briefing(
        self, db: Session, entities: dict, user_message: str
    ) -> OrchestratorResult:
        """Build a daily briefing from today's tasks and events."""
        from datetime import date, time as dt_time

        today = date.today()
        today_start = datetime.combine(today, dt_time.min, tzinfo=timezone.utc)
        today_end = datetime.combine(today, dt_time.max, tzinfo=timezone.utc)

        # Today's tasks
        today_tasks = (
            db.query(Todo)
            .filter(
                Todo.due_date >= today_start,
                Todo.due_date <= today_end,
                Todo.status.notin_(["completed", "cancelled"]),
            )
            .all()
        )

        # Overdue tasks
        overdue = (
            db.query(Todo)
            .filter(
                Todo.due_date < today_start,
                Todo.status.in_(["pending", "in_progress"]),
            )
            .all()
        )

        # Today's events
        events = (
            db.query(Event)
            .filter(Event.start_time >= today_start, Event.start_time <= today_end)
            .order_by(Event.start_time.asc())
            .all()
        )

        lines = [f"**Daily Briefing for {today.strftime('%B %d, %Y')}**\n"]

        if overdue:
            lines.append(f"**Overdue Tasks ({len(overdue)}):**")
            for t in overdue:
                lines.append(f"- {t.title} (due {t.due_date.strftime('%b %d') if t.due_date else 'no date'})")
            lines.append("")

        if today_tasks:
            lines.append(f"**Today's Tasks ({len(today_tasks)}):**")
            for t in today_tasks:
                lines.append(f"- [ ] {t.title} ({t.priority})")
            lines.append("")
        else:
            lines.append("**No tasks due today.**\n")

        if events:
            lines.append(f"**Today's Events ({len(events)}):**")
            for e in events:
                time_str = e.start_time.strftime("%I:%M %p")
                loc = f" at {e.location}" if e.location else ""
                lines.append(f"- {time_str}: {e.title}{loc}")
        else:
            lines.append("**No events scheduled for today.**")

        return OrchestratorResult(
            intent="daily_briefing",
            response_text="\n".join(lines),
        )

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_datetime(value: Any) -> Optional[datetime]:
        """Try to parse a datetime from various formats."""
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            for fmt in (
                "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d %H:%M",
                "%Y-%m-%d",
            ):
                try:
                    return datetime.strptime(value, fmt)
                except ValueError:
                    continue
        return None
