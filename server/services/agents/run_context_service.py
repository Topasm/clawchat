"""Bounded conversation context shared by every agent execution provider."""

import json

from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from models.todo import Todo
from services.agents import execution_host_service
from skills import get_skill
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_CONTEXT_MESSAGES = 12
MAX_MESSAGE_CHARS = 1_500
MAX_CONTEXT_CHARS = 10_000

#: Providers that hand the frozen instruction straight to a CLI in the
#: project's folder. The skill chain never runs on the server for them, so the
#: skills travel in the instruction. A chain run here sends each skill as its
#: system prompt instead, and OpenCode loads the skill files itself.
SKILL_TEXT_PROVIDERS = frozenset({"worker", "paseo"})


def skill_chain_block(task: AgentTask) -> str:
    """The instructions of every skill in the task's chain, in chain order."""
    try:
        chain = json.loads(task.skill_chain) if task.skill_chain else []
    except (json.JSONDecodeError, TypeError):
        chain = []
    skills = [
        skill
        for skill_id in chain
        if isinstance(skill_id, str) and (skill := get_skill(skill_id)) is not None
    ]
    blocks = [
        f"[Skill: {skill.id.replace('_', '-')}]\n{skill.system_prompt.strip()}"
        for skill in skills
    ]
    if len(blocks) > 1:
        blocks.insert(
            0, "[Skills]\nApply these skills in order; each one builds on the last."
        )
    return "\n\n".join(blocks)


async def build_execution_instruction(
    db: AsyncSession,
    task: AgentTask,
    *,
    include_skills: bool = False,
) -> str:
    """Freeze project rules and recent thread turns ahead of the task.

    ``include_skills`` adds the skill chain's instructions, for a provider in
    ``SKILL_TEXT_PROVIDERS`` that would otherwise never see them.
    """
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
    project = await db.get(Project, project_id) if project_id else None
    project_rules = project.execution_instructions if project else None
    # The folder the work runs in, as its machine described it. The CLI will
    # see the files itself, but the snapshot tells it what the folder is for
    # before it starts looking.
    workspace_block = (
        await execution_host_service.workspace_context_block(db, project)
        if project
        else ""
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
    if workspace_block:
        blocks.append(workspace_block)
    skills_block = skill_chain_block(task) if include_skills else ""
    if skills_block:
        blocks.append(skills_block)
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
