"""Bounded conversation context shared by every agent execution provider."""

from models.agent_task import AgentTask
from models.message import Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_CONTEXT_MESSAGES = 12
MAX_MESSAGE_CHARS = 1_500
MAX_CONTEXT_CHARS = 10_000


async def build_execution_instruction(
    db: AsyncSession,
    task: AgentTask,
    instruction: str | None = None,
) -> str:
    """Prepend recent thread turns while keeping the task instruction last."""
    base = instruction if instruction is not None else task.instruction
    if not task.conversation_id:
        return base
    messages = list(
        (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == task.conversation_id)
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(MAX_CONTEXT_MESSAGES)
            )
        ).scalars().all()
    )
    if not messages:
        return base
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
    return f"[Recent conversation]\n{context}\n\n[Task instruction]\n{base}"
