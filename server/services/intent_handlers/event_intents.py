"""Calendar intents: create / query / update / delete an event."""

from __future__ import annotations

from datetime import datetime

from models.conversation import Conversation
from services import calendar_service
from services.intent_handlers import (
    IntentContext,
    IntentHandlerDef,
    IntentReply,
    find_by_title,
    register_intent_handler,
)

_NO_TITLE = {
    "update": "Which event would you like to update? Please mention the event name.",
    "delete": "Which event would you like to delete? Please mention the event name.",
}


def _not_found(title: str) -> str:
    return f"I couldn't find an event matching '{title}'. Try checking your calendar first."


async def _resolve_target(ctx: IntentContext, action: str):
    """Return ``(event, error_reply)`` — exactly one of the two is set."""
    title = ctx.params.get("title", "")
    if not title:
        return None, (_NO_TITLE[action], None)
    events, _ = await calendar_service.get_events(ctx.db, limit=100)
    event = find_by_title(events, title)
    if not event:
        return None, (_not_found(title), None)
    return event, None


def _event_field(event, name: str):
    """Events come back as ORM rows or, for generated occurrences, as dicts."""
    return event[name] if isinstance(event, dict) else getattr(event, name)


async def create_event(ctx: IntentContext) -> IntentReply:
    params = ctx.params
    title = params.get("title", "Untitled event")
    start_time = params.get("start_time")
    if not start_time:
        return (
            f"I'd create event '{title}', but I need a start time. "
            "When should it be?",
            None,
        )
    project_id = None
    if ctx.conversation_id:
        conversation = await ctx.db.get(Conversation, ctx.conversation_id)
        if conversation is not None:
            project_id = conversation.project_id
    event = await calendar_service.create_event(
        ctx.db,
        title=title,
        description=params.get("description"),
        project_id=project_id,
        start_time=datetime.fromisoformat(start_time),
        end_time=(
            datetime.fromisoformat(params["end_time"])
            if params.get("end_time")
            else None
        ),
        location=params.get("location"),
    )
    return (
        f"Created event: '{event.title}' starting at {event.start_time}.",
        {"action_type": "event_created", "module": "events", "event_id": event.id, "event_title": event.title, "event_start_time": event.start_time.isoformat()},
    )


async def query_events(ctx: IntentContext) -> IntentReply:
    events, total = await calendar_service.get_events(ctx.db)
    if not events:
        return "You don't have any upcoming events.", None
    lines = [f"You have {total} event(s):"]
    for e in events[:5]:
        st = _event_field(e, "start_time")
        t = _event_field(e, "title")
        lines.append(f"- {t} at {st}")
    if total > 5:
        lines.append(f"...and {total - 5} more.")
    return "\n".join(lines), None


async def update_event(ctx: IntentContext) -> IntentReply:
    event, error = await _resolve_target(ctx, "update")
    if error is not None:
        return error
    params = ctx.params
    updates = {}
    if params.get("description"):
        updates["description"] = params["description"]
    if params.get("start_time"):
        updates["start_time"] = datetime.fromisoformat(params["start_time"])
    if params.get("end_time"):
        updates["end_time"] = datetime.fromisoformat(params["end_time"])
    if params.get("location"):
        updates["location"] = params["location"]
    if not updates:
        return f"I found '{event.title}', but I'm not sure what to change. What would you like to update?", None
    event = await calendar_service.update_event(ctx.db, event.id, **updates)
    return (
        f"Updated event '{event.title}'.",
        {"action_type": "event_updated", "module": "events", "event_id": event.id, "event_title": event.title},
    )


async def delete_event(ctx: IntentContext) -> IntentReply:
    event, error = await _resolve_target(ctx, "delete")
    if error is not None:
        return error
    deleted_title = event.title
    deleted_id = event.id
    await calendar_service.delete_event(ctx.db, event.id)
    return (
        f"Deleted event '{deleted_title}'.",
        {"action_type": "event_deleted", "module": "events", "event_id": deleted_id, "event_title": deleted_title},
    )


def register() -> None:
    for intent, handler in (
        ("create_event", create_event),
        ("query_events", query_events),
        ("update_event", update_event),
        ("delete_event", delete_event),
    ):
        register_intent_handler(
            IntentHandlerDef(intent=intent, handle=handler, module_intent=True)
        )
