"""Skill-chain execution engine.

Runs an ordered list of skills sequentially, passing each skill's output
as context to the next.  Optionally writes vault documents when a skill
has a ``vault_template``.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from models.agent_task import AgentTask
from models.todo import Todo
from services.ai_service import AIService
from services.agent_task_service import mark_completed, mark_failed, mark_running, update_progress
from skills import SKILL_REGISTRY, get_skill
from ws.manager import ConnectionManager

logger = logging.getLogger(__name__)


async def execute_skill_chain(
    db: AsyncSession,
    task: AgentTask,
    ai_service: AIService,
    ws_manager: ConnectionManager,
    user_id: str,
) -> None:
    """Execute a sequence of skills defined in ``task.skill_chain``.

    Each skill receives the previous skill's output as additional context.
    Progress is reported via WebSocket after each skill completes.
    """
    try:
        chain: list[str] = json.loads(task.skill_chain)  # type: ignore[arg-type]
    except (json.JSONDecodeError, TypeError):
        await mark_failed(db, task, f"Invalid skill_chain: {task.skill_chain}")
        await db.commit()
        return

    if not chain:
        await mark_failed(db, task, "Empty skill_chain")
        await db.commit()
        return

    # Validate all skill ids up-front.
    for sid in chain:
        if sid not in SKILL_REGISTRY:
            await mark_failed(db, task, f"Unknown skill '{sid}' in chain")
            await db.commit()
            return

    await mark_running(db, task)
    await db.commit()

    previous_result: str | None = None

    try:
        for i, skill_id in enumerate(chain):
            skill = SKILL_REGISTRY[skill_id]
            task.current_skill_index = i

            # Build user message — first skill gets raw instruction,
            # subsequent skills get previous output + original instruction.
            if i == 0 or not previous_result:
                user_msg = task.instruction
            else:
                user_msg = (
                    f"Previous step ({chain[i - 1]}) output:\n"
                    f"{previous_result}\n\n"
                    f"Original task: {task.instruction}"
                )

            progress = int((i / len(chain)) * 80) + 10
            await update_progress(
                db, task, progress, f"Running {skill.name}…", ws_manager, user_id,
            )
            await db.commit()

            result = await ai_service.generate_completion(
                system_prompt=skill.system_prompt,
                user_message=user_msg,
            )

            # Write vault document if the skill defines a template.
            if skill.vault_template and task.todo_id:
                await _write_vault_document(db, task, skill_id, result)

            previous_result = result

        # Final
        await update_progress(db, task, 95, "Finalizing…", ws_manager, user_id)
        await mark_completed(db, task, previous_result or "")
        await db.commit()

        await ws_manager.send_json(user_id, {
            "type": "task_completed",
            "data": {
                "task_id": task.id,
                "task_type": task.task_type,
                "result": previous_result,
                "conversation_id": task.conversation_id,
                "parent_task_id": task.parent_task_id,
                "skill_chain": chain,
            },
        })

    except Exception as exc:
        logger.exception("Skill chain execution failed for task %s", task.id)
        error_msg = f"Skill '{chain[task.current_skill_index]}' failed: {exc}"
        await mark_failed(db, task, error_msg)
        await db.commit()

        await ws_manager.send_json(user_id, {
            "type": "task_failed",
            "data": {
                "task_id": task.id,
                "task_type": task.task_type,
                "error": error_msg,
                "conversation_id": task.conversation_id,
                "parent_task_id": task.parent_task_id,
            },
        })


# ---------------------------------------------------------------------------
# Vault document helpers
# ---------------------------------------------------------------------------

def _sanitize(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip().rstrip(".")


async def _write_vault_document(
    db: AsyncSession,
    task: AgentTask,
    skill_id: str,
    content: str,
) -> None:
    """Write a vault document using the skill's template."""
    from config import settings
    from services import obsidian_cli_service as cli

    vault = settings.obsidian_vault_path
    if not vault:
        return

    skill = get_skill(skill_id)
    if not skill or not skill.vault_template:
        return

    todo: Todo | None = await db.get(Todo, task.todo_id) if task.todo_id else None
    if not todo:
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    project = todo.source_id or _sanitize(todo.title)
    title = _sanitize(todo.title)[:50]

    doc_path = (
        skill.vault_template
        .replace("{project}", project)
        .replace("{date}", today)
        .replace("{title}", title)
    )

    full_content = (
        f"---\n"
        f"created: {today}\n"
        f"task: {todo.title}\n"
        f"task_id: {todo.id}\n"
        f"skill: {skill_id}\n"
        f"---\n\n"
        f"# {skill.name}: {todo.title}\n\n"
        f"{content}\n"
    )

    try:
        cli.create_document(doc_path, full_content)
    except Exception:
        logger.warning("Failed to write vault document %s", doc_path, exc_info=True)
