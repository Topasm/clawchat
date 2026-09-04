"""Bounded conversation context shared by every agent execution provider."""

from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from models.todo import Todo
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_CONTEXT_MESSAGES = 12
MAX_MESSAGE_CHARS = 1_500
MAX_CONTEXT_CHARS = 10_000


async def build_execution_instruction(
    db: AsyncSession,
    task: AgentTask,
) -> str:
    """Freeze project rules and recent thread turns ahead of the task."""
    project_id = None
    if task.todo_id:
        project_id = (
            await db.execute(select(Todo.project_id).where(Todo.id == task.todo_id))
        ).scalar_one_or_none()
    if project_id is None and task.conversation_id:
        project_id = (
            await db.execute(
                select(Conversation.project_id).where(
                    Conversation.id == task.conversation_id
                )
            )
        ).scalar_one_or_none()
    project_rules = (
        await db.scalar(
            select(Project.execution_instructions).where(Project.id == project_id)
        )
        if project_id
        else None
    )

    messages = []
    if task.conversation_id:
        message_query = select(Message).where(
            Message.conversation_id == task.conversation_id
        )
        if task.message_id:
            # The triggering message is already represented by task.instruction.
            message_query = message_query.where(Message.id != task.message_id)
        messages = list(
            (
                await db.execute(
                    message_query.order_by(
                        Message.created_at.desc(), Message.id.desc()
                    ).limit(MAX_CONTEXT_MESSAGES)
                )
            )
            .scalars()
            .all()
        )
    lines: list[str] = []
    for message in reversed(messages):
        role = "User" if message.role == "user" else "Assistant"
        content = message.content.strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:MAX_MESSAGE_CHARS]}")
    context = "\n\n".join(lines)
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[-MAX_CONTEXT_CHARS:]

    blocks: list[str] = []
    if project_rules and project_rules.strip():
        blocks.append(f"[Project rules]\n{project_rules.strip()}")
    if context:
        blocks.append(f"[Recent conversation]\n{context}")
    if not blocks:
        return task.instruction
    blocks.append(f"[Task instruction]\n{task.instruction}")
    return "\n\n".join(blocks)


async def active_execution_instruction(db: AsyncSession, task: AgentTask) -> str:
    """Use the current run's immutable input, or build it before a run exists."""
    run = getattr(task, "_active_agent_run", None)
    if run is not None:
        return run.instruction_snapshot
    return await build_execution_instruction(db, task)
