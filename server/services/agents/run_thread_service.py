"""Every agent run lives in a conversation, and its decision points are messages.

Chat-delegated work already had a conversation; work started from the Inbox
had none, so its progress was only ever visible on the Runs page. Giving each
run a thread and writing the moments that need a person -- a question, a
result to review, an approval, a failure -- into it as ordinary assistant
messages means the conversation reads as the record of what happened, and
stays the one place to look, whichever surface started the work.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from models.todo import Todo
from services.agents import execution_host_service
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id
from ws.notifications import DEFAULT_USER_ID, notify_after_commit

RUN_UPDATE_MESSAGE_TYPE = "run_update"


async def ensure_thread(db: AsyncSession, run: AgentRun, task: AgentTask) -> str:
    """Return the task's conversation id, creating the conversation if needed.

    The new conversation is scoped like a chat opened from the project page,
    so project context and the project chat list both pick it up.
    """
    if task.conversation_id:
        return task.conversation_id
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    root_task_id = None
    if run.project_id:
        root_task_id = (
            await db.execute(
                select(Project.root_task_id).where(Project.id == run.project_id)
            )
        ).scalar_one_or_none()
    conversation = Conversation(
        id=make_id("conv_"),
        title=(todo.title if todo else task.instruction)[:80],
        project_id=run.project_id,
        project_todo_id=root_task_id,
        metadata_json=json.dumps(
            {"origin": "agent_run", "todo_id": task.todo_id, "agent_task_id": task.id}
        ),
    )
    db.add(conversation)
    await db.flush()
    task.conversation_id = conversation.id
    return conversation.id


def _quote(title: str) -> str:
    return f"“{title}”"


def _compose(event_type: str, run: AgentRun, title: str) -> str | None:
    """The message for a lifecycle event, or None when it is not a decision point."""
    quoted = _quote(title)
    detail = (run.progress_message or "").strip()
    summary = (run.result_summary or "").strip()
    if event_type in {"waiting_input", "waiting_permission", "changes_requested"}:
        text = f"I need your input to continue {quoted}."
        if event_type == "changes_requested":
            text = f"Changes were requested for {quoted}. Add a follow-up to continue."
        return f"{text}\n\n{detail}" if detail and event_type != "changes_requested" else text
    if event_type == "waiting_reminder":
        text = f"Still waiting on your answer to continue {quoted}."
        return f"{text}\n\n{detail}" if detail else text
    if event_type == "waiting_review":
        text = f"{quoted} is ready for your review."
        return f"{text}\n\n{summary}" if summary else text
    if event_type == "resuming":
        return f"Resuming {quoted} with your follow-up."
    if event_type == "approved":
        return f"You approved {quoted}. The task is complete."
    if event_type == "rejected":
        return f"You rejected the result for {quoted}."
    if event_type == "completed":
        text = f"{quoted} finished."
        return f"{text}\n\n{summary}" if summary else text
    if event_type == "failed":
        error = (run.error or "").strip()
        return f"{quoted} failed: {error}" if error else f"{quoted} failed."
    if event_type == "cancelled":
        return f"{quoted} was cancelled."
    return None


async def post_run_update(
    db: AsyncSession,
    run: AgentRun,
    task: AgentTask,
    *,
    review_id: str | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> Message | None:
    """Write the run's latest lifecycle event into its thread, once.

    Keyed on the event sequence through the message idempotency index, so a
    transition that is notified twice (a retry, a reconnect) leaves one row.
    Sub-task runs report through their parent and are not written.
    """
    if task.parent_task_id or not task.conversation_id:
        return None
    latest = (
        await db.execute(
            select(AgentRunEvent)
            .where(AgentRunEvent.run_id == run.id)
            .order_by(AgentRunEvent.sequence.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest is None:
        return None
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    title = todo.title if todo else run.instruction_snapshot.splitlines()[0][:120]
    text = _compose(latest.event_type, run, title)
    if text is None:
        return None
    try:
        event_payload = json.loads(latest.payload_json) if latest.payload_json else {}
    except (json.JSONDecodeError, TypeError):
        event_payload = {}
    key = f"run:{run.id}:{latest.sequence}"
    exists = (
        await db.execute(
            select(func.count(Message.id)).where(
                Message.conversation_id == task.conversation_id,
                Message.idempotency_key == key,
            )
        )
    ).scalar_one()
    if exists:
        return None
    message = Message(
        id=make_id("msg_"),
        conversation_id=task.conversation_id,
        role="assistant",
        content=text,
        message_type=RUN_UPDATE_MESSAGE_TYPE,
        idempotency_key=key,
        metadata_json=json.dumps(
            {
                "action_type": "run_update",
                "run_id": run.id,
                "host_label": await execution_host_service.run_host_label(db, run),
                "agent_task_id": task.id,
                "todo_id": task.todo_id,
                "title": title,
                "status": str(run.status),
                "event_type": latest.event_type,
                "attempt": run.attempt,
                "progress_message": run.progress_message,
                "result_summary": run.result_summary,
                "error": run.error,
                "review_id": review_id,
                "is_adopted": run.is_adopted,
                "input_options": event_payload.get("options") or [],
                "permissions": event_payload.get("permissions") or [],
            },
            ensure_ascii=False,
        ),
    )
    db.add(message)
    conversation = await db.get(Conversation, task.conversation_id)
    if conversation is not None:
        conversation.updated_at = datetime.now(timezone.utc)
    await db.flush()
    notify_after_commit(
        db,
        {
            "type": "conversation_updated",
            "data": {"conversation_id": task.conversation_id, "message_id": message.id},
        },
        user_id,
    )
    return message
