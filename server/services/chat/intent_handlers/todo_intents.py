"""Task intents: create / query / complete / update / delete a todo."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from domain.task import TaskStatus
from models.conversation import Conversation
from models.todo import Todo
from services.tasks import todo_recurrence_service, todo_service
from services.chat.intent_handlers import (
    IntentContext,
    IntentHandlerDef,
    IntentReply,
    find_by_title,
    register_intent_handler,
)

logger = logging.getLogger(__name__)

_NO_TITLE = {
    "complete": "Which task would you like to complete? Please mention the task name.",
    "update": "Which task would you like to update? Please mention the task name.",
    "delete": "Which task would you like to delete? Please mention the task name.",
}


def _not_found(title: str) -> str:
    return f"I couldn't find a task matching '{title}'. Try listing your tasks first."


def _parse_due_date(raw: object) -> datetime | None:
    """Coerce a classifier-supplied due date into a ``datetime``.

    Creating and updating a task receive the *same* LLM-produced ISO string in
    ``params["due_date"]``, so they have to read it the same way.  The update
    path has always parsed it; the create path used to hand the raw string to
    ``todo_service.create_todo``, which types the column as ``DateTime`` and so
    blew up at flush time with a driver-level error.

    A malformed value raises, exactly as the update path does.  The orchestrator
    turns that into the "I tried to create a todo but something went wrong"
    reply for module intents, so the user is told.  Silently substituting
    ``None`` would be worse: the task would be created without the due date the
    user explicitly asked for, and nothing would say so.
    """
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw
    return datetime.fromisoformat(str(raw))


async def _resolve_target(ctx: IntentContext, action: str):
    """Return ``(todo, error_reply)`` — exactly one of the two is set."""
    title = ctx.params.get("title", "")
    if not title:
        return None, (_NO_TITLE[action], None)
    todos, _ = await todo_service.get_todos(ctx.db, limit=100)
    todo = find_by_title(todos, title)
    if not todo:
        return None, (_not_found(title), None)
    return todo, None


async def create_todo(ctx: IntentContext) -> IntentReply:
    # A named parent wins ("add a step under X"); otherwise a thread scoped to
    # a task or project puts the new task under it.
    parent_id = ctx.params.get("parent_id")
    parent_title = (ctx.params.get("parent_title") or "").strip()
    project_id = None
    if not parent_id and parent_title:
        todos, _ = await todo_service.get_todos(ctx.db, limit=100)
        parent = find_by_title(todos, parent_title)
        if parent is None:
            return _not_found(parent_title), None
        parent_id = parent.id
    if not parent_id and ctx.conversation_id:
        conv = await ctx.db.get(Conversation, ctx.conversation_id)
        if conv and conv.project_todo_id:
            parent_id = conv.project_todo_id
        if conv:
            project_id = conv.project_id
    todo = await todo_service.create_todo(
        ctx.db,
        title=ctx.params.get("title", "Untitled task"),
        description=ctx.params.get("description"),
        parent_id=parent_id,
        project_id=project_id,
        due_date=_parse_due_date(ctx.params.get("due_date")),
        recurrence_rule=ctx.params.get("recurrence_rule"),
    )
    parent = await ctx.db.get(Todo, parent_id) if parent_id else None
    text = (
        f"Added '{todo.title}' as a step under '{parent.title}'."
        if parent is not None
        else f"Created task: '{todo.title}'."
    )
    return (
        text,
        {
            "action_type": "todo_created",
            "module": "todos",
            "todo_id": todo.id,
            "todo_title": todo.title,
            "parent_id": parent_id,
        },
    )


async def plan_task(ctx: IntentContext) -> IntentReply:
    """Break a task into steps with the planner; the plan comes back for review.

    Targets the named task, else the task this thread is scoped to. The
    planner is the same pipeline the task page's "Plan this task" runs, and
    it runs in the background: the reply confirms, the proposal arrives as a
    review item and as a plan on the task.
    """
    title = (ctx.params.get("title") or "").strip()
    todo = None
    if title:
        todos, _ = await todo_service.get_todos(ctx.db, limit=100)
        todo = find_by_title(todos, title)
        if todo is None:
            return _not_found(title), None
    elif ctx.conversation_id:
        conv = await ctx.db.get(Conversation, ctx.conversation_id)
        if conv and conv.project_todo_id:
            todo = await ctx.db.get(Todo, conv.project_todo_id)
    if todo is None:
        return "Which task should I plan? Name it, or ask from that task's thread.", None

    from services.planning import inbox_pipeline_service

    todo_id, ai = todo.id, ctx.ai
    if ctx.session_factory is not None:
        session_factory = ctx.session_factory

        async def _plan() -> None:
            try:
                async with session_factory() as plan_db:
                    await inbox_pipeline_service.process_todo(plan_db, ai, todo_id)
            except Exception:
                logger.exception("Planning from chat failed for todo %s", todo_id)

        asyncio.create_task(_plan())
    else:
        await inbox_pipeline_service.process_todo(ctx.db, ai, todo_id)
    return (
        f"Planning '{todo.title}'. I'll propose steps for you to review; they become "
        "sub-tasks once you apply them.",
        {"action_type": "plan_started", "module": "todos", "todo_id": todo.id, "todo_title": todo.title},
    )


async def query_todos(ctx: IntentContext) -> IntentReply:
    todos, total = await todo_service.get_todos(ctx.db)
    if not todos:
        return "You don't have any tasks yet.", None
    lines = [f"You have {total} task(s):"]
    for t in todos[:5]:
        lines.append(f"- [{t.status}] {t.title}")
    if total > 5:
        lines.append(f"...and {total - 5} more.")
    return "\n".join(lines), None


async def complete_todo(ctx: IntentContext) -> IntentReply:
    todo, error = await _resolve_target(ctx, "complete")
    if error is not None:
        return error
    was_completed = todo.status == TaskStatus.COMPLETED
    todo = await todo_service.update_todo(
        ctx.db,
        todo.id,
        status=TaskStatus.COMPLETED,
    )
    # Completing through chat must continue a recurring series the
    # same way the REST update does; otherwise the series silently
    # ends whenever the user says "done" instead of ticking the box.
    message = f"Marked '{todo.title}' as complete."
    metadata = {
        "action_type": "todo_completed",
        "module": "todos",
        "todo_id": todo.id,
        "todo_title": todo.title,
    }
    spawned = await todo_recurrence_service.spawn_next_occurrences(
        ctx.db,
        [todo] if not was_completed else [],
    )
    if spawned:
        next_todo = spawned[0]
        metadata["next_todo_id"] = next_todo.id
        if next_todo.due_date:
            message += f" Next one is due {next_todo.due_date.date().isoformat()}."
    return message, metadata


async def update_todo(ctx: IntentContext) -> IntentReply:
    todo, error = await _resolve_target(ctx, "update")
    if error is not None:
        return error
    params = ctx.params
    updates = {}
    if params.get("description"):
        updates["description"] = params["description"]
    if params.get("due_date"):
        updates["due_date"] = _parse_due_date(params["due_date"])
    if params.get("status"):
        updates["status"] = params["status"]
    if not updates:
        return f"I found '{todo.title}', but I'm not sure what to change. What would you like to update?", None
    todo = await todo_service.update_todo(ctx.db, todo.id, **updates)
    return (
        f"Updated task '{todo.title}'.",
        {"action_type": "todo_updated", "module": "todos", "todo_id": todo.id, "todo_title": todo.title},
    )


async def delete_todo(ctx: IntentContext) -> IntentReply:
    todo, error = await _resolve_target(ctx, "delete")
    if error is not None:
        return error
    deleted_title = todo.title
    deleted_id = todo.id
    await todo_service.delete_todo(ctx.db, todo.id)
    return (
        f"Deleted task '{deleted_title}'.",
        {"action_type": "todo_deleted", "module": "todos", "todo_id": deleted_id, "todo_title": deleted_title},
    )


def register() -> None:
    for intent, handler in (
        ("create_todo", create_todo),
        ("query_todos", query_todos),
        ("complete_todo", complete_todo),
        ("update_todo", update_todo),
        ("delete_todo", delete_todo),
        ("plan_task", plan_task),
    ):
        register_intent_handler(
            IntentHandlerDef(intent=intent, handle=handler, module_intent=True)
        )
