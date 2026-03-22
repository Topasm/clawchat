"""Vault agent service — document-generating agents for Obsidian vault.

Three agent roles create and update vault documents:
- **planner**: Creates ``Plan/YYYY-MM-DD.md`` documents with structured plans
- **researcher**: Creates ``Research/`` documents with investigation findings
- **executor**: Updates ``TODO.md`` with progress and completion markers

All document operations use the CLI service (with filesystem fallback).
"""

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.agent_task import AgentTask
from models.todo import Todo
from services.ai_service import AIService
from services import obsidian_cli_service as cli
from services.obsidian_context_service import read_project_context
from services.obsidian_export_service import export_todo
from utils import make_id, strip_markdown_fences

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def execute_agent_task(
    db: AsyncSession,
    ai_service: AIService,
    agent_task: AgentTask,
) -> None:
    """Execute a vault agent task based on its agent_type or skill_chain.

    If the task has a skill_chain, dispatches via the skill executor.
    Otherwise falls back to the legacy persona-based handlers.
    """
    # Skill-chain path — preferred for new tasks.
    if agent_task.skill_chain:
        from skills.executor import _write_vault_document
        from skills import get_skill
        import json as _json

        skill_ids = _json.loads(agent_task.skill_chain)
        agent_task.status = "in_progress"
        agent_task.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            for skill_id in skill_ids:
                skill = get_skill(skill_id)
                if not skill:
                    continue
                result = await ai_service.generate_completion(
                    skill.system_prompt,
                    agent_task.instruction,
                )
                if skill.vault_template and agent_task.todo_id:
                    await _write_vault_document(db, agent_task, skill_id, result)

            agent_task.status = "completed"
            agent_task.payload_json = json.dumps({"result": result}) if result else None
            agent_task.completed_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception as exc:
            logger.exception("Skill-based vault task %s failed", agent_task.id)
            agent_task.status = "failed"
            agent_task.error = str(exc)
            agent_task.completed_at = datetime.now(timezone.utc)
            await db.commit()
        return

    # Legacy persona-based handlers.
    handlers = {
        "planner": _handle_planner,
        "researcher": _handle_researcher,
        "executor": _handle_executor,
    }

    handler = handlers.get(agent_task.agent_type)
    if not handler:
        agent_task.status = "failed"
        agent_task.error = f"Unknown agent type: {agent_task.agent_type}"
        agent_task.completed_at = datetime.now(timezone.utc)
        await db.commit()
        return

    agent_task.status = "in_progress"
    agent_task.started_at = datetime.now(timezone.utc)
    await db.commit()

    try:
        result = await handler(db, ai_service, agent_task)
        agent_task.status = "completed"
        agent_task.payload_json = json.dumps(result) if isinstance(result, dict) else result
        agent_task.completed_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception as exc:
        logger.exception("Agent task %s failed", agent_task.id)
        agent_task.status = "failed"
        agent_task.error = str(exc)
        agent_task.completed_at = datetime.now(timezone.utc)
        await db.commit()


# ---------------------------------------------------------------------------
# Planner agent
# ---------------------------------------------------------------------------

_PLANNER_SYSTEM_PROMPT = """\
You are a planning assistant. Given a task and its context, create a detailed
implementation plan document in markdown format.

The plan should include:
- A clear objective statement
- Step-by-step action items with time estimates
- Dependencies and prerequisites
- Potential risks or blockers
- Success criteria

Format as clean markdown suitable for an Obsidian vault."""


async def _handle_planner(
    db: AsyncSession,
    ai_service: AIService,
    task: AgentTask,
) -> dict:
    """Generate a plan document and write it to the vault."""
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    if not todo:
        return {"error": "Todo not found", "document_created": False}

    vault = settings.obsidian_vault_path
    if not vault:
        return {"error": "Vault not configured", "document_created": False}

    # Gather context
    context_parts = [f"Task: {todo.title}"]
    if todo.description:
        context_parts.append(f"Description: {todo.description}")

    if todo.source_id:
        try:
            ctx = read_project_context(vault, todo.source_id, settings.obsidian_cli_command)
            if ctx.get("todo_md"):
                context_parts.append(f"Project TODO:\n{ctx['todo_md']}")
            for doc in ctx.get("related_docs", []):
                context_parts.append(f"Related ({doc['name']}):\n{doc['content'][:500]}")
        except Exception:
            logger.debug("Could not read project context for planner")

    # Generate plan via LLM
    user_message = "\n\n".join(context_parts)
    try:
        plan_content = await ai_service.generate_completion(
            _PLANNER_SYSTEM_PROMPT, user_message
        )
    except Exception:
        logger.exception("LLM call failed for planner agent")
        return {"error": "LLM unavailable", "document_created": False}

    # Write plan document
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    project_folder = todo.source_id or _sanitize(todo.title)
    doc_path = f"{project_folder}/Plan/{today}.md"

    # Add frontmatter
    full_content = (
        f"---\n"
        f"created: {today}\n"
        f"task: {todo.title}\n"
        f"task_id: {todo.id}\n"
        f"agent: planner\n"
        f"---\n\n"
        f"# Plan: {todo.title}\n\n"
        f"{plan_content}\n"
    )

    created = cli.create_document(doc_path, full_content)

    return {
        "document_created": created,
        "document_path": doc_path,
        "plan_summary": plan_content[:200],
    }


# ---------------------------------------------------------------------------
# Researcher agent
# ---------------------------------------------------------------------------

_RESEARCHER_SYSTEM_PROMPT = """\
You are a research assistant. Given a task, investigate and compile relevant
information into a well-structured research document.

The document should include:
- Executive summary
- Key findings organized by topic
- Relevant references or resources
- Recommended next steps
- Open questions

Format as clean markdown suitable for an Obsidian vault."""


async def _handle_researcher(
    db: AsyncSession,
    ai_service: AIService,
    task: AgentTask,
) -> dict:
    """Generate a research document and write it to the vault."""
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    if not todo:
        return {"error": "Todo not found", "document_created": False}

    vault = settings.obsidian_vault_path
    if not vault:
        return {"error": "Vault not configured", "document_created": False}

    # Gather context
    context_parts = [f"Research task: {todo.title}"]
    if todo.description:
        context_parts.append(f"Description: {todo.description}")

    if task.instruction:
        context_parts.append(f"Instruction: {task.instruction}")

    if todo.source_id:
        try:
            ctx = read_project_context(vault, todo.source_id, settings.obsidian_cli_command)
            for doc in ctx.get("related_docs", []):
                context_parts.append(f"Existing doc ({doc['name']}):\n{doc['content'][:500]}")
        except Exception:
            logger.debug("Could not read project context for researcher")

    # Generate research via LLM
    user_message = "\n\n".join(context_parts)
    try:
        research_content = await ai_service.generate_completion(
            _RESEARCHER_SYSTEM_PROMPT, user_message
        )
    except Exception:
        logger.exception("LLM call failed for researcher agent")
        return {"error": "LLM unavailable", "document_created": False}

    # Write research document
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    project_folder = todo.source_id or _sanitize(todo.title)
    safe_title = _sanitize(todo.title)[:50]
    doc_path = f"{project_folder}/Research/{safe_title}_{today}.md"

    full_content = (
        f"---\n"
        f"created: {today}\n"
        f"task: {todo.title}\n"
        f"task_id: {todo.id}\n"
        f"agent: researcher\n"
        f"---\n\n"
        f"# Research: {todo.title}\n\n"
        f"{research_content}\n"
    )

    created = cli.create_document(doc_path, full_content)

    return {
        "document_created": created,
        "document_path": doc_path,
        "research_summary": research_content[:200],
    }


# ---------------------------------------------------------------------------
# Executor agent
# ---------------------------------------------------------------------------


async def _handle_executor(
    db: AsyncSession,
    ai_service: AIService,
    task: AgentTask,
) -> dict:
    """Update TODO.md with progress and sync todo status."""
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    if not todo:
        return {"error": "Todo not found", "updated": False}

    vault = settings.obsidian_vault_path
    if not vault:
        return {"error": "Vault not configured", "updated": False}

    # Get child todos for progress tracking
    child_q = select(Todo).where(Todo.parent_id == todo.id)
    children = list((await db.execute(child_q)).scalars().all())

    completed = sum(1 for c in children if c.status == "completed")
    total = len(children)

    # Update progress in the instruction/result
    progress_summary = f"{completed}/{total} subtasks completed"

    # Build progress note for TODO.md
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    progress_line = f"\n<!-- claw:progress:{todo.id} -->\n> **Progress** ({now}): {progress_summary}\n"

    if todo.source_id:
        todo_md_path = f"{todo.source_id}/{settings.obsidian_project_todo_filename}"
        cli.append_to_document(todo_md_path, progress_line)

    # Re-export the todo to sync state
    project_name = None
    if todo.parent_id:
        parent = await db.get(Todo, todo.parent_id)
        if parent:
            project_name = parent.title
    export_todo(vault, todo, project_name)

    # Export children too
    for child in children:
        export_todo(vault, child, todo.title)

    return {
        "updated": True,
        "progress": progress_summary,
        "children_synced": len(children),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sanitize(name: str) -> str:
    """Sanitize a string for use as a directory/file name."""
    import re
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip().rstrip(".")
