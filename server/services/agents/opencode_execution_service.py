"""Run delegated work with OpenCode, in a sandbox on this machine.

ClawChat keeps the run -- its row, events, review and tool approvals -- and
OpenCode keeps the agent: skills, the tool loop, the model. Each run gets its
own ``opencode serve`` confined to the project's path, and that process, with
everything it started, ends with the run: on completion, on cancel, and when
ClawChat itself stops. A restart therefore leaves nothing to reattach; the
startup reconcile marks such a run interrupted and a retry starts afresh.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import AsyncExitStack, suppress
from datetime import datetime, timezone
from typing import Any

from config import settings
from domain.agent_run import AgentRunStatus
from domain.review import ArtifactType
from exceptions import NotFoundError, ValidationError
from execution.opencode_server import (
    OpenCodeAdapter,
    OpenCodeError,
    OpenCodeServer,
    run_config,
)
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service, execution_host_service
from services.agents.execution_host_service import WorkspaceResolution
from services.review import artifact_service
from skills import get_skill
from skills.builtins import BUILTIN_SKILLS_DIR, user_skills_dir
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from ws.notifications import notify_module_data_changed

logger = logging.getLogger(__name__)

PROVIDER = "opencode"
#: Beyond this many, tool calls still count toward progress but are not logged.
MAX_TOOL_EVENTS = 200
HEARTBEAT_SECONDS = 15.0
REFRESH_SECONDS = 5.0
#: OpenCode writes a prompt's diff summary just after the session goes idle.
DIFF_SUMMARY_ATTEMPTS = 10
DIFF_SUMMARY_INTERVAL = 0.3
#: The patch rides on the run until review; a runaway rewrite is cut here.
MAX_PATCH_CHARS = 400_000
UNATTENDED_REJECTION = (
    "This ClawChat run is unattended, so nobody can approve that. "
    "Continue without it."
)


def adapter_from_settings() -> OpenCodeAdapter:
    return OpenCodeAdapter(
        command=settings.opencode_command,
        enabled=settings.opencode_enabled,
        sandbox=settings.opencode_sandbox,
        startup_timeout_seconds=settings.opencode_startup_timeout_seconds,
    )


def workspace_problem(workspace: WorkspaceResolution | None) -> tuple[str, str] | None:
    """``(code, message)`` when OpenCode cannot run this project's work here."""
    if workspace is None or workspace.is_unconfigured:
        return (
            "OPENCODE_WORKSPACE_REQUIRED",
            "Configure the project's execution workspace path before using OpenCode",
        )
    host = workspace.host
    if host is not None and host.kind != "local":
        return (
            "OPENCODE_WORKSPACE_REQUIRED",
            f"OpenCode runs on the ClawChat server, but this project's work lives on {host.label}",
        )
    if not os.path.isdir(os.path.expanduser(workspace.path or "")):
        return (
            "EXECUTION_HOST_UNAVAILABLE",
            f"{workspace.path} does not exist on the ClawChat server",
        )
    return None


def run_prompt(instruction: str, skill_id: str | None) -> str:
    """The instruction, naming the skill the work was delegated with.

    OpenCode would pick a skill by its description anyway; naming it keeps
    the run doing what the person chose rather than what the model guessed.
    """
    skill = get_skill(skill_id) if skill_id else None
    if skill is None:
        return instruction
    name = skill.id.replace("_", "-")
    return f"Use the `{name}` skill for this task.\n\n{instruction}"


def _skills_paths() -> list[str]:
    """The built-in skills, plus the user's own directory when it exists."""
    paths = [str(BUILTIN_SKILLS_DIR)]
    user_dir = user_skills_dir()
    if user_dir is not None and user_dir.is_dir():
        paths.append(str(user_dir))
    return paths


def _skill_id(task: AgentTask) -> str | None:
    try:
        chain = json.loads(task.skill_chain) if task.skill_chain else []
    except (json.JSONDecodeError, TypeError):
        chain = []
    if chain and isinstance(chain[0], str):
        return chain[0]
    if task.task_type and task.task_type.startswith("delegate_"):
        return task.task_type.removeprefix("delegate_")
    return None


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
        raise ValidationError("OpenCode execution requires a project-scoped task")
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    return run, task, project, todo


async def _notify_run_state(user_id: str = "user") -> None:
    for module in ("runs", "reviews", "projects", "artifacts", "todos"):
        await notify_module_data_changed(module, user_id)


def _event_session(properties: dict[str, Any]) -> str | None:
    return (
        properties.get("sessionID")
        or (properties.get("info") or {}).get("sessionID")
        or (properties.get("part") or {}).get("sessionID")
    )


def _error_text(error: dict[str, Any] | None) -> str | None:
    if not error:
        return None
    data = error.get("data") or {}
    message = data.get("message") if isinstance(data, dict) else None
    return f"{error.get('name', 'Error')}: {message}" if message else str(error.get("name", "Error"))


def summarize_reply(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """The answer to the latest prompt: its text, error, model and usage."""
    last_user = max(
        (i for i, message in enumerate(messages) if message["info"].get("role") == "user"),
        default=-1,
    )
    replies = [
        message
        for message in messages[last_user + 1 :]
        if message["info"].get("role") == "assistant"
    ]
    text = ""
    error = None
    tokens = {"input": 0, "output": 0, "reasoning": 0}
    cost = 0.0
    model = None
    for message in replies:
        info = message["info"]
        parts_text = "".join(
            part.get("text", "")
            for part in message.get("parts", [])
            if part.get("type") == "text" and not part.get("synthetic")
        ).strip()
        if parts_text:
            text = parts_text
        error = error or _error_text(info.get("error"))
        for key in tokens:
            tokens[key] += int((info.get("tokens") or {}).get(key) or 0)
        cost += float(info.get("cost") or 0)
        if info.get("providerID") and info.get("modelID"):
            model = f"{info['providerID']}/{info['modelID']}"
    return {"text": text, "error": error, "tokens": tokens, "cost": cost, "model": model}


def prompt_diff(messages: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, Any]] | None]:
    """The latest prompt's id and the file changes OpenCode recorded for it.

    The changes are ``None`` until OpenCode has summarized them. The
    session-wide diff endpoint is not a substitute: it can stay empty while
    the prompt's own summary already holds the patch.
    """
    for message in reversed(messages):
        info = message["info"]
        if info.get("role") == "user":
            diffs = (info.get("summary") or {}).get("diffs")
            return info.get("id"), diffs if isinstance(diffs, list) else None
    return None, None


async def _changed_files(
    server: OpenCodeServer, session_id: str, messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    for attempt in range(DIFF_SUMMARY_ATTEMPTS):
        message_id, diffs = prompt_diff(messages)
        if diffs is not None:
            return diffs
        if attempt + 1 < DIFF_SUMMARY_ATTEMPTS:
            await asyncio.sleep(DIFF_SUMMARY_INTERVAL)
            messages = await server.messages(session_id)
    return await server.diff(session_id, message_id)


def _patch(files: list[dict[str, Any]]) -> str:
    patch = "\n".join(item.get("patch") or "" for item in files if item.get("patch"))
    if len(patch) > MAX_PATCH_CHARS:
        return patch[:MAX_PATCH_CHARS] + "\n…(patch truncated)"
    return patch


def result_text(reply: str, files: list[dict[str, Any]]) -> str:
    lines = [reply or "OpenCode finished without a summary."]
    if files:
        lines += ["", "Changed files:"]
        lines += [
            f"- {item.get('file', '?')} (+{int(item.get('additions') or 0)} "
            f"-{int(item.get('deletions') or 0)})"
            for item in files
        ]
    else:
        lines += ["", "No files changed."]
    return "\n".join(lines)


class _Progress:
    """Turns OpenCode's event stream into run events without flooding them."""

    def __init__(self, db: AsyncSession, run: AgentRun, task: AgentTask, user_id: str):
        self.db = db
        self.run = run
        self.task = task
        self.user_id = user_id
        self.tool_calls = 0
        self.last_heartbeat = 0.0
        self.last_refresh = 0.0

    async def tool_finished(self, part: dict[str, Any]) -> None:
        state = part.get("state") or {}
        self.tool_calls += 1
        tool = part.get("tool", "tool")
        title = state.get("title") or ""
        self.run.progress = min(90, 10 + 3 * self.tool_calls)
        self.run.progress_message = f"{tool}: {title}" if title else tool
        self.task.progress = self.run.progress
        self.task.progress_message = self.run.progress_message
        if self.tool_calls <= MAX_TOOL_EVENTS:
            await agent_run_service.record_event(
                self.db,
                self.run,
                "tool_call",
                self.run.progress_message[:500],
                progress=self.run.progress,
                payload={"tool": tool, "status": state.get("status"), "title": title[:200]},
            )
        await self.db.commit()
        await self.tick()

    async def tick(self) -> None:
        """Called on every event; does work only when a period has passed."""
        now = time.monotonic()
        if now - self.last_heartbeat >= HEARTBEAT_SECONDS:
            self.last_heartbeat = now
            await self.db.refresh(self.run, attribute_names=["status"])
            if self.run.status == AgentRunStatus.CANCELLED:
                raise asyncio.CancelledError
            self.run.heartbeat_at = datetime.now(timezone.utc)
            await self.db.commit()
        if now - self.last_refresh >= REFRESH_SECONDS:
            self.last_refresh = now
            await notify_module_data_changed("runs", self.user_id)


async def _drive(
    db: AsyncSession,
    server: OpenCodeServer,
    *,
    run: AgentRun,
    task: AgentTask,
    todo: Todo | None,
    user_id: str,
    timeout_seconds: float,
    prompt: str,
) -> None:
    """Send the instruction, follow the session to idle, and hand in the result."""
    title = todo.title if todo else task.task_type
    session_id = await server.create_session(f"ClawChat · {title}")
    run.external_run_id = session_id
    run.progress = 10
    run.progress_message = "OpenCode session started"
    await agent_run_service.record_event(
        db,
        run,
        "provider_started",
        f"OpenCode session {session_id} started",
        progress=10,
        payload={"session_id": session_id, "cwd": server.directory},
    )
    await db.commit()
    await agent_run_service.mark_running(db, run)
    task.status = "running"
    await db.commit()
    await _notify_run_state(user_id)

    progress = _Progress(db, run, task, user_id)
    session_error: str | None = None
    busy = False
    events = server.events()
    try:
        async with asyncio.timeout(timeout_seconds):
            # Subscribe before prompting, or a quick answer finishes unseen.
            await anext(events)
            await server.prompt(session_id, prompt)
            async for event in events:
                kind = event.get("type")
                properties = event.get("properties") or {}
                if _event_session(properties) not in (session_id, None):
                    continue
                if kind == "message.part.updated":
                    part = properties.get("part") or {}
                    status = (part.get("state") or {}).get("status")
                    if part.get("type") == "tool" and status in ("completed", "error"):
                        await progress.tool_finished(part)
                elif kind == "permission.asked":
                    await server.reply_permission(
                        properties["id"], "reject", UNATTENDED_REJECTION
                    )
                    await agent_run_service.record_event(
                        db,
                        run,
                        "permission_denied",
                        f"Denied {properties.get('permission')} (unattended run)",
                        progress=run.progress,
                        payload={"patterns": properties.get("patterns") or []},
                    )
                elif kind == "question.asked":
                    await server.reject_question(properties["id"])
                elif kind == "session.error":
                    error = properties.get("error") or {}
                    if error.get("name") != "MessageAbortedError":
                        session_error = _error_text(error)
                elif kind == "session.status":
                    state = (properties.get("status") or {}).get("type")
                    if state == "busy":
                        busy = True
                    elif state == "idle" and (busy or session_error):
                        break
                elif kind == "session.idle" and (busy or session_error):
                    break
                await progress.tick()
    except TimeoutError:
        with suppress(OpenCodeError):
            await server.abort(session_id)
        raise ValidationError(
            f"OpenCode did not finish within {timeout_seconds:g}s; the session was stopped"
        ) from None
    finally:
        await events.aclose()

    messages = await server.messages(session_id)
    reply = summarize_reply(messages)
    error = session_error or reply["error"]
    if error:
        raise ValidationError(error)
    files = await _changed_files(server, session_id, messages)
    run.usage_json = json.dumps(
        {
            "session_id": session_id,
            "cwd": server.directory,
            "model": reply["model"],
            "tokens": reply["tokens"],
            "cost": reply["cost"],
            "tool_calls": progress.tool_calls,
            "files": [
                {
                    "file": item.get("file"),
                    "status": item.get("status"),
                    "additions": item.get("additions"),
                    "deletions": item.get("deletions"),
                }
                for item in files
            ],
            "patch": _patch(files),
        },
        ensure_ascii=False,
    )
    # Completion reloads the run, so what it carries must be saved first.
    await db.commit()
    result = result_text(reply["text"], files)
    task._active_agent_run = run
    await agent_task_service.mark_completed(db, task, result)
    run.result_summary = result[-500:]
    await db.commit()
    await _notify_run_state(user_id)


async def execute_run(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: str,
    *,
    user_id: str = "user",
    adapter: OpenCodeAdapter | None = None,
) -> None:
    from services.tools import agent_mcp_endpoint, approvals, cli_tool_args
    from services.tools.catalog import tools_for_skill

    adapter = adapter or adapter_from_settings()
    async with session_factory() as db:
        try:
            run, task, project, todo = await _load_context(db, run_id)
            task._active_agent_run = run
            workspace = await execution_host_service.resolve_workspace(db, project)
            problem = workspace_problem(workspace)
            if problem is not None:
                raise ValidationError(problem[1])
            if run.status == AgentRunStatus.QUEUED:
                await agent_run_service.mark_starting(db, run)
                task.status = "running"
                await db.commit()
            skill_id = _skill_id(task)
            specs = await tools_for_skill(db, skill_id) if skill_id else []
            async with AsyncExitStack() as stack:
                tools = (
                    await stack.enter_async_context(
                        agent_mcp_endpoint.run_scope(run.id, specs, session_factory)
                    )
                    if specs
                    else None
                )
                config = run_config(
                    model=run.model or settings.opencode_model or None,
                    tools_url=tools.url if tools else None,
                    tools_token=tools.token if tools else None,
                    tool_timeout_ms=cli_tool_args.TOOL_CALL_TIMEOUT_SECONDS * 1000,
                    skills_paths=_skills_paths(),
                )
                server = await stack.enter_async_context(
                    adapter.serve(workspace.path or "", config=config)
                )
                await _drive(
                    db,
                    server,
                    run=run,
                    task=task,
                    todo=todo,
                    user_id=user_id,
                    timeout_seconds=settings.opencode_run_timeout_seconds,
                    prompt=run_prompt(run.instruction_snapshot, skill_id),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("OpenCode AgentRun %s failed", run_id)
            try:
                await db.rollback()
                run, task, _project, _todo = await _load_context(db, run_id)
                task._active_agent_run = run
                if run.status not in (AgentRunStatus.CANCELLED, AgentRunStatus.FAILED):
                    await agent_task_service.mark_failed(
                        db, task, getattr(exc, "message", None) or str(exc)
                    )
                    await db.commit()
                    await _notify_run_state(user_id)
            except Exception:
                logger.exception("Could not persist OpenCode AgentRun failure for %s", run_id)
        finally:
            # A CLI that exits or gives up leaves nothing to approve.
            approvals.cancel_for_run(run_id)


async def publish_adopted_output(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
) -> None:
    """Keep the approved run's changes as a diff artifact on the project."""
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
    try:
        metadata = json.loads(run.usage_json) if run.usage_json else {}
    except (json.JSONDecodeError, TypeError):
        metadata = {}
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    await artifact_service.create_artifact(
        db,
        project_id=run.project_id,
        task_id=task.todo_id,
        type=ArtifactType.CODE_DIFF,
        title=f"OpenCode changes · {todo.title if todo else task.task_type}",
        content=metadata.get("patch") or run.result or "",
        source=PROVIDER,
        created_by=run.id,
    )
