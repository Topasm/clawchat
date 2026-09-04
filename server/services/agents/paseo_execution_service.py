"""Bridge durable ClawChat AgentRuns to externally supervised Paseo agents."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from config import settings
from domain.agent_run import AGENT_RUN_EXECUTING_STATUSES, AgentRunStatus
from domain.review import ArtifactType
from exceptions import ConflictError, NotFoundError, ValidationError
from execution.paseo_cli import PaseoCLIAdapter, PaseoCLIError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.project import Project
from models.todo import Todo
from services.agents import (
    agent_run_service,
    agent_task_service,
    execution_host_service,
)
from services.review import artifact_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from ws.notifications import notify_module_data_changed


logger = logging.getLogger(__name__)


def adapter_from_settings() -> PaseoCLIAdapter:
    return PaseoCLIAdapter(
        command=settings.paseo_cli_command,
        host=settings.paseo_host,
        enabled=settings.paseo_enabled,
        command_timeout_seconds=settings.paseo_command_timeout_seconds,
    )


def _branch_slug(title: str, run_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "task"
    return f"clawchat/{slug}-{run_id[-6:]}"


async def _load_context(
    db: AsyncSession, run_id: str
) -> tuple[AgentRun, AgentTask, Project, Todo | None]:
    run = await db.get(AgentRun, run_id)
    if run is None:
        raise NotFoundError("Agent run not found")
    task = await db.get(AgentTask, run.agent_task_id)
    if task is None:
        raise NotFoundError("Agent task not found")
    project = await db.get(Project, run.project_id) if run.project_id else None
    if project is None:
        raise ValidationError("Paseo execution requires a project-scoped task")
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    return run, task, project, todo


async def _notify_run_state(user_id: str = "user") -> None:
    for module in ("runs", "reviews", "projects", "artifacts", "todos"):
        await notify_module_data_changed(module, user_id)


async def publish_adopted_output(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
) -> None:
    if not run.project_id:
        return
    existing = (
        await db.execute(
            select(Artifact).where(
                Artifact.project_id == run.project_id,
                Artifact.created_by == run.id,
                Artifact.type == ArtifactType.CODE_DIFF,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    try:
        provider_metadata = json.loads(run.usage_json) if run.usage_json else {}
    except (json.JSONDecodeError, TypeError):
        provider_metadata = {}
    content = json.dumps(
        {"provider": provider_metadata, "result": run.result or ""},
        ensure_ascii=False,
        indent=2,
    )
    await artifact_service.create_artifact(
        db,
        project_id=run.project_id,
        task_id=task.todo_id,
        type=ArtifactType.CODE_DIFF,
        title=f"Paseo output · {todo.title if todo else task.task_type}",
        content=content,
        source="paseo",
        created_by=run.id,
    )


async def _monitor_agent(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
    adapter: PaseoCLIAdapter,
    user_id: str,
    poll_interval: float,
    reconnect_grace_seconds: float,
) -> None:
    if not run.external_run_id:
        raise RuntimeError("Paseo agent ID is missing")
    failures = 0
    max_failures = max(3, int(reconnect_grace_seconds / max(poll_interval, 0.05)))
    provider_running_recorded = False
    while True:
        try:
            snapshot = await adapter.inspect_agent(run.external_run_id)
            failures = 0
        except PaseoCLIError as exc:
            failures += 1
            await db.refresh(run)
            if run.status == AgentRunStatus.CANCELLED:
                return
            run.heartbeat_at = datetime.now(timezone.utc)
            run.progress_message = f"Reconnecting to Paseo ({failures}/{max_failures})"
            if failures == 1:
                await agent_run_service.record_event(
                    db,
                    run,
                    "provider_disconnected",
                    exc.message,
                    progress=run.progress,
                    payload={"code": exc.code},
                )
            if failures >= max_failures:
                await agent_task_service.mark_failed(
                    db,
                    task,
                    f"Paseo connection was unavailable for {reconnect_grace_seconds:g}s: {exc.message}",
                )
                await db.commit()
                await _notify_run_state(user_id)
                return
            await db.commit()
            await asyncio.sleep(poll_interval)
            continue

        await db.refresh(run)
        if run.status == AgentRunStatus.CANCELLED:
            return
        now = datetime.now(timezone.utc)
        run.heartbeat_at = now
        provider_metadata = {
            "agent_id": snapshot.id,
            "workspace_id": run.workspace_id,
            "host": run.host_id,
            "provider": snapshot.provider,
            "model": snapshot.model,
            "cwd": snapshot.cwd,
            "worktree": snapshot.worktree,
            "pending_permissions": list(snapshot.pending_permissions),
            "usage": snapshot.usage,
        }
        run.usage_json = json.dumps(provider_metadata, ensure_ascii=False)

        if snapshot.pending_permissions:
            run.status = AgentRunStatus.WAITING_INPUT
            run.progress_message = "Paseo is waiting for permission"
            task.status = "running"
            await agent_run_service.record_event(
                db,
                run,
                "waiting_permission",
                "Resolve the pending permission in Paseo, then resume monitoring",
                progress=run.progress,
                payload={"permissions": list(snapshot.pending_permissions)},
            )
            await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
            await db.commit()
            await _notify_run_state(user_id)
            return

        if snapshot.status in {"running", "created", "starting"}:
            resumed_from_input = run.status == AgentRunStatus.WAITING_INPUT
            run.status = AgentRunStatus.RUNNING
            run.progress = max(run.progress, 25)
            run.progress_message = f"Paseo agent {snapshot.status}"
            task.status = "running"
            task.progress = run.progress
            task.progress_message = run.progress_message
            if not provider_running_recorded:
                await agent_run_service.record_event(
                    db,
                    run,
                    "provider_running",
                    f"Paseo agent {snapshot.id} is running",
                    progress=run.progress,
                    payload={"agent_id": snapshot.id, "workspace_id": run.workspace_id},
                )
                provider_running_recorded = True
            if resumed_from_input:
                await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
            await db.commit()
            await asyncio.sleep(poll_interval)
            continue

        if snapshot.status == "idle":
            result = await adapter.logs(snapshot.id)
            if not result.strip():
                result = "Paseo agent completed without a transcript."
            task._active_agent_run = run
            await agent_task_service.mark_completed(db, task, result)
            run.result_summary = result[-500:]
            await db.commit()
            await _notify_run_state(user_id)
            return

        if snapshot.status in {"error", "failed"}:
            await agent_task_service.mark_failed(
                db, task, f"Paseo agent ended with status {snapshot.status}"
            )
            await db.commit()
            await _notify_run_state(user_id)
            return

        run.progress_message = f"Paseo agent status: {snapshot.status}"
        await db.commit()
        await asyncio.sleep(poll_interval)


async def execute_run(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: str,
    *,
    user_id: str = "user",
    adapter: PaseoCLIAdapter | None = None,
    poll_interval: float | None = None,
    reconnect_grace_seconds: float | None = None,
) -> None:
    adapter = adapter or adapter_from_settings()
    poll_interval = poll_interval or settings.paseo_poll_interval_seconds
    reconnect_grace_seconds = (
        reconnect_grace_seconds or settings.paseo_reconnect_grace_seconds
    )
    async with session_factory() as db:
        try:
            run, task, project, todo = await _load_context(db, run_id)
            task._active_agent_run = run
            if run.status == AgentRunStatus.QUEUED:
                await agent_run_service.mark_starting(db, run)
                task.status = "running"
                await db.commit()
            workspace = await execution_host_service.resolve_workspace(db, project)
            workspace_path = workspace.path or ""
            if not workspace_path:
                raise ValidationError(
                    "Configure the project's execution workspace path before using Paseo"
                )
            if not run.workspace_id:
                workspace = await adapter.create_workspace(
                    path=workspace_path,
                    isolation=project.execution_workspace_isolation,
                    title=f"ClawChat · {todo.title if todo else project.title}",
                    branch_name=(
                        _branch_slug(todo.title if todo else project.title, run.id)
                        if project.execution_workspace_isolation == "worktree"
                        else None
                    ),
                    base_branch=project.execution_base_branch,
                )
                run.workspace_id = workspace.id
                run.host_id = adapter.host_label
                await agent_run_service.record_event(
                    db,
                    run,
                    "workspace_created",
                    f"Paseo {workspace.isolation} workspace created",
                    progress=5,
                    payload={"workspace_id": workspace.id, "cwd": workspace.cwd},
                )
                await db.commit()
            if not run.external_run_id:
                agent = await adapter.start_agent(
                    workspace_id=run.workspace_id,
                    provider_model=run.model or settings.paseo_default_provider,
                    prompt=run.instruction_snapshot,
                    title=todo.title if todo else task.task_type,
                    labels={
                        "clawchat.run_id": run.id,
                        "clawchat.project_id": project.id,
                    },
                )
                run.external_run_id = agent.id
                run.host_id = adapter.host_label
                await agent_run_service.record_event(
                    db,
                    run,
                    "provider_started",
                    f"Paseo agent {agent.id} started",
                    progress=10,
                    payload={"agent_id": agent.id, "workspace_id": run.workspace_id},
                )
                run.progress = 10
                run.progress_message = "Paseo agent started"
                # Persist the external identity before any further provider
                # call. A crash from this point is reattachable on startup.
                await db.commit()
                await agent_run_service.mark_running(db, run)
                task.status = "running"
                await db.commit()
                await _notify_run_state(user_id)
            await _monitor_agent(
                db,
                run=run,
                task=task,
                adapter=adapter,
                user_id=user_id,
                poll_interval=poll_interval,
                reconnect_grace_seconds=reconnect_grace_seconds,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Paseo AgentRun %s failed", run_id)
            try:
                run, task, _project, _todo = await _load_context(db, run_id)
                task._active_agent_run = run
                if run.status != AgentRunStatus.CANCELLED:
                    await agent_task_service.mark_failed(db, task, str(exc))
                    await db.commit()
                    await _notify_run_state(user_id)
            except Exception:
                logger.exception(
                    "Could not persist Paseo AgentRun failure for %s", run_id
                )


async def cancel_external_run(
    run: AgentRun,
    *,
    adapter: PaseoCLIAdapter | None = None,
) -> str | None:
    if run.provider != "paseo" or not run.external_run_id:
        return None
    adapter = adapter or adapter_from_settings()
    try:
        await adapter.stop_agent(run.external_run_id)
        return None
    except PaseoCLIError as exc:
        # Local cancellation must remain possible during daemon outages. The
        # event records that the external stop could not be confirmed.
        logger.warning("Could not stop Paseo agent %s: %s", run.external_run_id, exc)
        return exc.message


async def resume_external_run(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: str,
    follow_up: str,
    *,
    user_id: str = "user",
    adapter: PaseoCLIAdapter | None = None,
) -> None:
    adapter = adapter or adapter_from_settings()
    async with session_factory() as db:
        run, task, _project, _todo = await _load_context(db, run_id)
        if run.provider != "paseo" or not run.external_run_id:
            raise ConflictError("Paseo agent identity is unavailable")
        await adapter.send_follow_up(run.external_run_id, follow_up)
        run.status = AgentRunStatus.RUNNING
        run.progress = max(10, min(run.progress, 90))
        run.progress_message = "Follow-up sent to Paseo"
        run.completed_at = None
        run.error = None
        task.status = "running"
        task.error = None
        await agent_run_service.record_event(
            db,
            run,
            "follow_up_sent",
            "Follow-up instruction sent to Paseo",
            progress=run.progress,
        )
        await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
        await db.commit()
    await execute_run(session_factory, run_id, user_id=user_id, adapter=adapter)


async def recover_active_runs(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    adapter: PaseoCLIAdapter | None = None,
) -> int:
    adapter = adapter or adapter_from_settings()
    async with session_factory() as db:
        run_ids = list(
            (
                await db.execute(
                    select(AgentRun.id).where(
                        AgentRun.provider == "paseo",
                        AgentRun.external_run_id.is_not(None),
                        AgentRun.status.in_(AGENT_RUN_EXECUTING_STATUSES),
                    )
                )
            )
            .scalars()
            .all()
        )
    for run_id in run_ids:
        agent_run_service.launch_execution(
            run_id,
            execute_run(session_factory, run_id, adapter=adapter),
        )
    return len(run_ids)
