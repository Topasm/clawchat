"""Skill-chain execution engine.

Runs an ordered list of skills sequentially, passing each skill's output
as context to the next.  Optionally writes vault documents when a skill
has a ``vault_template``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from models.agent_task import AgentTask
from models.todo import Todo
from services.ai.ai_service import AIService
from services.agents.agent_task_service import (
    generate_agent_turn,
    mark_completed,
    mark_failed,
    mark_running,
    request_input,
    update_progress,
)
from services.agents.run_context_service import build_execution_instruction
from skills import SKILL_REGISTRY, get_skill
from ws.manager import ConnectionManager

logger = logging.getLogger(__name__)

SKILL_CHAIN_STATE_KEY = "_skill_chain_execution"


def _task_payload(task: AgentTask) -> dict:
    if not task.payload_json:
        return {}
    try:
        payload = json.loads(task.payload_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def reset_skill_chain_checkpoint(task: AgentTask) -> None:
    """Start a new run attempt without discarding unrelated task payload."""
    task.current_skill_index = 0
    payload = _task_payload(task)
    payload.pop(SKILL_CHAIN_STATE_KEY, None)
    task.payload_json = json.dumps(payload, ensure_ascii=False) if payload else None


def _load_skill_chain_checkpoint(task: AgentTask, chain: list[str]) -> tuple[int, list[str]]:
    payload = _task_payload(task)
    state = payload.get(SKILL_CHAIN_STATE_KEY)
    if not isinstance(state, dict) or state.get("chain") != chain:
        return 0, []
    outputs = state.get("outputs")
    if not isinstance(outputs, list) or not all(isinstance(item, str) for item in outputs):
        return 0, []
    start = task.current_skill_index
    if start < 0 or start > len(chain) or len(outputs) < start:
        return 0, []
    return start, outputs[:start]


def _save_skill_chain_checkpoint(
    task: AgentTask, chain: list[str], outputs: list[str]
) -> None:
    payload = _task_payload(task)
    payload[SKILL_CHAIN_STATE_KEY] = {"chain": chain, "outputs": outputs}
    task.payload_json = json.dumps(payload, ensure_ascii=False)


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

    start_index, outputs = _load_skill_chain_checkpoint(task, chain)
    previous_result = outputs[-1] if outputs else None
    execution_instruction = await build_execution_instruction(db, task)

    try:
        for i in range(start_index, len(chain)):
            skill_id = chain[i]
            skill = SKILL_REGISTRY[skill_id]
            task.current_skill_index = i

            # Build user message — first skill gets raw instruction,
            # subsequent skills get previous output + original instruction.
            if i == 0 or previous_result is None:
                user_msg = execution_instruction
            else:
                user_msg = (
                    f"Previous step ({chain[i - 1]}) output:\n"
                    f"{previous_result}\n\n"
                    f"Original task: {execution_instruction}"
                )

            progress = int((i / len(chain)) * 80) + 10
            await update_progress(
                db, task, progress, f"Running {skill.name}…", ws_manager, user_id,
            )
            await db.commit()

            result, input_request = await generate_agent_turn(
                ai_service,
                system_prompt=skill.system_prompt,
                user_message=user_msg,
            )

            # The skill asked instead of answering. Completed outputs are
            # already checkpointed, so a follow-up reruns this skill only.
            if input_request is not None:
                await request_input(
                    db, task, input_request.question, input_request.options
                )
                await db.commit()
                return

            result = result or ""

            # Write vault document if the skill defines a template.
            if skill.vault_template and task.todo_id:
                await _write_vault_document(db, task, skill_id, result)

            if len(outputs) == i:
                outputs.append(result)
            else:
                outputs[i] = result
                del outputs[i + 1:]
            task.current_skill_index = i + 1
            _save_skill_chain_checkpoint(task, chain, outputs)
            await db.commit()
            previous_result = result

        # Final
        await update_progress(db, task, 95, "Finalizing…", ws_manager, user_id)
        await mark_completed(db, task, previous_result or "")
        await db.commit()

        run = getattr(task, "_active_agent_run", None)
        await ws_manager.send_json(user_id, {
            "type": "task_completed",
            "data": {
                "task_id": task.id,
                "task_type": task.task_type,
                "result": previous_result,
                "conversation_id": task.conversation_id,
                "parent_task_id": task.parent_task_id,
                "skill_chain": chain,
                "run_id": run.id if run is not None else None,
                "run_status": str(run.status) if run is not None else None,
            },
        })

    except Exception as exc:
        logger.exception("Skill chain execution failed for task %s", task.id)
        error_msg = f"Skill '{chain[task.current_skill_index]}' failed: {exc}"
        await mark_failed(db, task, error_msg)
        await db.commit()

        run = getattr(task, "_active_agent_run", None)
        await ws_manager.send_json(user_id, {
            "type": "task_failed",
            "data": {
                "task_id": task.id,
                "task_type": task.task_type,
                "error": error_msg,
                "conversation_id": task.conversation_id,
                "parent_task_id": task.parent_task_id,
                "run_id": run.id if run is not None else None,
                "run_status": str(run.status) if run is not None else None,
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
    from services.vault import obsidian_cli_service as cli

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
        await asyncio.to_thread(cli.create_document, doc_path, full_content)
    except Exception:
        logger.warning("Failed to write vault document %s", doc_path, exc_info=True)
