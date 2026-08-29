"""Delegating a task to a skill, and launching its run.

Extracted from the todo router: this is 190 lines of provider selection,
readiness gating, and background execution wiring that the HTTP layer had no
business owning. Keeping it here also makes it reachable from the chat
orchestrator, which currently has a second, less capable delegation path.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from config import settings
from exceptions import AppError, NotFoundError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.todo import Todo
from schemas.task import DelegateRequest
from services.agents import (
    agent_run_service,
    agent_task_service,
    paseo_execution_service,
)
from services.planning import (
    inbox_pipeline_service,
)
from services.tasks import (
    task_execution_service,
)
from skills import PERSONA_TO_SKILL, SKILL_REGISTRY
from utils import make_id
from ws.manager import ws_manager
from ws.notifications import notify_module_data_changed

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DelegationRuntime:
    """Process-level dependencies the router reads off ``app.state``.

    Passing these explicitly keeps the delegation logic callable without a
    FastAPI request, which is what the orchestrator would need.
    """

    # Only needed once execution actually starts. Requiring it up front would
    # make a request that fails validation depend on it, which changes which
    # error a caller sees.
    session_factory: async_sessionmaker[AsyncSession] | None
    active_ai: Any | None
    active_ai_provider: str
    paseo_adapter: Any | None = None


def resolve_skill_id(body: DelegateRequest) -> str:
    """Resolve the requested skill, accepting the legacy persona names."""
    skill_id = body.skill_id
    if not skill_id and body.agent_type:
        skill_id = PERSONA_TO_SKILL.get(body.agent_type, body.agent_type)
    if not skill_id or skill_id not in SKILL_REGISTRY:
        raise AppError(
            code="UNKNOWN_SKILL",
            message=f"Unknown skill: {skill_id}",
            status_code=422,
        )
    if body.require_ready and skill_id == "plan":
        raise AppError(
            code="PLAN_EXECUTION_UNSUPPORTED",
            message="Use the planning workflow instead of executing the plan skill",
            status_code=422,
        )
    return skill_id


async def delegate_todo_to_skill(
    db: AsyncSession,
    todo_id: str,
    body: DelegateRequest,
    runtime: DelegationRuntime,
    user_id: str,
) -> dict:
    skill_id = resolve_skill_id(body)

    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    if body.require_ready:
        await task_execution_service.validate_ready_execution(db, todo)

    task = AgentTask(
        id=make_id("task_"),
        agent_type=skill_id,
        task_type=f"delegate_{skill_id}",
        instruction=f"Handle: {todo.title}\n{todo.description or ''}",
        todo_id=todo.id,
        skill_chain=json.dumps([skill_id]),
    )
    db.add(task)
    await db.flush()
    active_ai = runtime.active_ai
    active_provider = runtime.active_ai_provider
    project = await db.get(Project, todo.project_id) if todo.project_id else None
    configured_provider = body.execution_provider or (
        project.default_execution_provider if project else None
    )
    provider = (
        "paseo"
        if configured_provider == "paseo" and skill_id != "plan"
        else active_provider
    )
    paseo_adapter = None
    if provider == "paseo":
        paseo_adapter = runtime.paseo_adapter or (
            paseo_execution_service.adapter_from_settings()
        )
        if not paseo_adapter.enabled:
            raise AppError(
                code="PASEO_DISABLED",
                message="Paseo execution is disabled on this ClawChat server",
                status_code=503,
            )
        if project is None or not (project.execution_workspace_path or "").strip():
            raise AppError(
                code="PASEO_WORKSPACE_REQUIRED",
                message="Configure the project's execution workspace path before using Paseo",
                status_code=409,
            )
    elif active_ai is None:
        raise AppError(
            code="AI_UNAVAILABLE",
            message="No execution provider is available",
            status_code=503,
        )
    run_model = (
        body.model
        or (project.default_execution_model if project else None)
        or (
            settings.paseo_default_provider
            if provider == "paseo"
            else getattr(active_ai, "model", None)
        )
    )
    if body.require_ready:
        await task_execution_service.claim_ready_execution(db, todo.id)
        await db.refresh(todo)
    run = await agent_run_service.create_run(
        db,
        task,
        provider=provider,
        model=run_model,
        host_id=paseo_adapter.host_label if paseo_adapter else None,
        update_todo_status=skill_id != "plan" and not body.require_ready,
    )

    # Update todo with skill assignment.
    todo.assignee = skill_id  # backward compat
    # Merge into enabled_skills (additive).
    existing: list[str] = json.loads(todo.enabled_skills) if todo.enabled_skills else []
    if skill_id not in existing:
        existing.append(skill_id)
    todo.enabled_skills = json.dumps(existing)
    await db.commit()

    session_factory = runtime.session_factory
    if session_factory is None:
        raise AppError(
            code="EXECUTION_UNAVAILABLE",
            message="The server has no database session factory to run this task with",
            status_code=503,
        )

    async def _execute_delegation() -> None:
        async with session_factory() as run_db:
            run_task = await run_db.get(AgentTask, task.id)
            run_row = await run_db.get(AgentRun, run.id)
            if run_task is None or run_row is None:
                return
            if skill_id == "plan":
                try:
                    await agent_run_service.mark_starting(run_db, run_row)
                    await agent_run_service.mark_running(run_db, run_row)
                    await run_db.commit()
                    await inbox_pipeline_service.process_todo(
                        run_db, active_ai, todo_id
                    )
                    run_task.status = "completed"
                    run_task.result = "Plan proposal ready for review"
                    run_task.progress = 100
                    run_task.completed_at = datetime.now(timezone.utc)
                    run_row.status = "completed"
                    run_row.progress = 100
                    run_row.result = run_task.result
                    run_row.result_summary = run_task.result
                    run_row.is_adopted = True
                    run_row.completed_at = run_task.completed_at
                    await agent_run_service.record_event(
                        run_db,
                        run_row,
                        "completed",
                        run_task.result,
                        progress=100,
                    )
                    await run_db.commit()
                except Exception as exc:
                    run_task.status = "failed"
                    run_task.error = str(exc)
                    run_task.completed_at = datetime.now(timezone.utc)
                    await agent_run_service.mark_failed(run_db, run_row, str(exc))
                    await run_db.commit()
            else:
                await agent_task_service.execute_task(
                    run_db,
                    run_task,
                    active_ai,
                    ws_manager,
                    user_id,
                    session_factory=session_factory,
                    run=run_row,
                    provider=provider,
                    model=run_model,
                )
            await notify_module_data_changed("runs")
            await notify_module_data_changed("reviews")
            await notify_module_data_changed("projects")

    if provider == "paseo":
        agent_run_service.launch_execution(
            run.id,
            paseo_execution_service.execute_run(
                session_factory,
                run.id,
                user_id=user_id,
                adapter=paseo_adapter,
            ),
        )
    else:
        agent_run_service.launch_execution(run.id, _execute_delegation())
    await notify_module_data_changed("runs")
    await notify_module_data_changed("projects")

    return {
        "status": "delegated",
        "task_id": task.id,
        "todo_id": todo.id,
        "agent_task_id": task.id,
        "run_id": run.id,
        "skill_id": skill_id,
        "skill_chain": [skill_id],
        "agent_type": skill_id,  # backward compat
    }
