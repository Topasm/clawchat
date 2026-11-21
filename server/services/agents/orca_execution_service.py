"""Bridge durable ClawChat AgentRuns to a chat in the user's running Orca.

ClawChat keeps the run -- its row, events, review and the person's answers to
approvals -- and Orca keeps the agent: the worktree, the CLI it runs (Codex
by default), that CLI's sandbox. ClawChat never starts Orca; it talks to the
``orca-ide serve`` the user runs on this machine. Orca outlives a ClawChat
restart, so a run that was executing is reattached on startup instead of
being declared interrupted.

One run is one Orca chat. Its permission mode is set before the first
message, because a new Orca chat would otherwise inherit "full-access". When
the agent stops for an approval, the run waits for input and the run card's
Allow / Deny answers it in Orca.
"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
import os
import re
import time
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

from config import settings
from domain.agent_run import AGENT_RUN_EXECUTING_STATUSES, AgentRunStatus
from domain.review import ArtifactType
from exceptions import ConflictError, NotFoundError, ValidationError
from execution.orca_cli import (
    SETTLED_STATES,
    WORKING_STATES,
    OrcaAdapter,
    OrcaError,
)
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service, execution_host_service
from services.agents.execution_host_service import WorkspaceResolution
from services.review import artifact_service
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from ws.notifications import notify_module_data_changed

logger = logging.getLogger(__name__)

PROVIDER = "orca"
#: The patch rides on the run until review; a runaway rewrite is cut here.
MAX_PATCH_CHARS = 400_000
MAX_FILE_CHARS = 200_000
#: A settled chat with no reply to the prompt yet: how many polls before the
#: turn counts as finished anyway (it was stopped before the agent answered).
SETTLED_WITHOUT_REPLY_POLLS = 5
#: How much of the prompt identifies it in Orca's transcript.
PROMPT_HEAD_CHARS = 120
#: Errors that mean Orca itself could not be used, not that one call failed.
_UNREACHABLE_CODES = frozenset(
    {"ORCA_NOT_RUNNING", "ORCA_TIMEOUT", "runtime_unavailable", "ORCA_START_FAILED"}
)


def adapter_from_settings() -> OrcaAdapter:
    return OrcaAdapter(
        command=settings.orca_cli_command,
        user_data_path=settings.orca_user_data_path,
        enabled=settings.orca_enabled,
        command_timeout_seconds=settings.orca_command_timeout_seconds,
    )


def default_model(agent: str) -> str | None:
    """The model a run uses when nobody picked one: the CLI's cheap tier."""
    if settings.orca_model:
        return settings.orca_model
    if agent == "codex":
        return settings.codex_cli_model or None
    if agent == "claude":
        return settings.claude_code_model or None
    return None


def workspace_problem(workspace: WorkspaceResolution | None) -> tuple[str, str] | None:
    """``(code, message)`` when Orca on this machine cannot run this project's work."""
    if workspace is None or workspace.is_unconfigured:
        return (
            "ORCA_WORKSPACE_REQUIRED",
            "Configure the project's execution workspace path before using Orca",
        )
    host = workspace.host
    if host is not None and host.kind != "local":
        return (
            "ORCA_WORKSPACE_REQUIRED",
            f"Orca runs on the ClawChat server, but this project's work lives on {host.label}",
        )
    if not os.path.isdir(os.path.expanduser(workspace.path or "")):
        return (
            "EXECUTION_HOST_UNAVAILABLE",
            f"{workspace.path} does not exist on the ClawChat server",
        )
    return None


def _branch_slug(title: str, run_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "task"
    return f"clawchat/{slug}-{run_id[-6:]}"


def _metadata(run: AgentRun) -> dict[str, Any]:
    try:
        value = json.loads(run.usage_json) if run.usage_json else {}
    except (json.JSONDecodeError, TypeError):
        value = {}
    return value if isinstance(value, dict) else {}


def _save_metadata(run: AgentRun, metadata: dict[str, Any]) -> None:
    run.usage_json = json.dumps(metadata, ensure_ascii=False)


def _prompt_head(text: str) -> str:
    return text.strip()[:PROMPT_HEAD_CHARS]


def _answers_prompt(entries: tuple[dict[str, Any], ...], head: str | None) -> bool:
    """Whether the transcript's latest user message is the prompt ClawChat sent."""
    if not head:
        return True
    for entry in reversed(entries):
        if entry.get("kind") == "message" and entry.get("role") == "user":
            return str(entry.get("text") or "").strip().startswith(head)
    # The prompt scrolled out of the window: the turn is long past it.
    return True


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
        raise ValidationError("Orca execution requires a project-scoped task")
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    return run, task, project, todo


async def _notify_run_state(user_id: str = "user") -> None:
    for module in ("runs", "reviews", "projects", "artifacts", "todos"):
        await notify_module_data_changed(module, user_id)


def _unified(path: str, before: str, after: str) -> str:
    lines = difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
    )
    text = "".join(line if line.endswith("\n") else line + "\n" for line in lines)
    return text[:MAX_FILE_CHARS] + ("\n…(file diff truncated)\n" if len(text) > MAX_FILE_CHARS else "")


async def collect_changes(
    adapter: OrcaAdapter, worktree_path: str
) -> tuple[list[dict[str, Any]], str]:
    """The workspace's uncommitted changes as Orca sees them, and one patch."""
    entries = await adapter.changed_files(worktree_path)
    files: list[dict[str, Any]] = []
    patches: list[str] = []
    for entry in entries:
        path = str(entry.get("path") or "")
        if not path:
            continue
        files.append(
            {
                "file": path,
                "status": entry.get("status"),
                "additions": entry.get("added"),
                "deletions": entry.get("removed"),
            }
        )
        try:
            diff = await adapter.file_diff(
                worktree_path, path, staged=entry.get("area") == "staged"
            )
        except OrcaError as exc:
            patches.append(f"# {path}: diff unavailable ({exc.message})\n")
            continue
        if diff.get("originalIsBinary") or diff.get("modifiedIsBinary"):
            patches.append(f"Binary file {path} changed\n")
            continue
        patches.append(
            _unified(path, str(diff.get("originalContent") or ""), str(diff.get("modifiedContent") or ""))
        )
    patch = "".join(patches)
    if len(patch) > MAX_PATCH_CHARS:
        patch = patch[:MAX_PATCH_CHARS] + "\n…(patch truncated)"
    return files, patch


def result_text(reply: str | None, files: list[dict[str, Any]]) -> str:
    lines = [reply or "Orca finished without a summary."]
    if files:
        lines += ["", "Changed files:"]
        lines += [
            f"- {item['file']} (+{int(item.get('additions') or 0)} -{int(item.get('deletions') or 0)})"
            for item in files
        ]
    else:
        lines += ["", "No files changed."]
    return "\n".join(lines)


async def _finish(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
    adapter: OrcaAdapter,
    reply: str | None,
    user_id: str,
) -> None:
    metadata = _metadata(run)
    files, patch = await collect_changes(adapter, run.workspace_id or "")
    metadata.update(files=files, patch=patch, pending_requests=[])
    _save_metadata(run, metadata)
    # Completion reloads the run, so what it carries must be saved first.
    await db.commit()
    result = result_text(reply, files)
    task._active_agent_run = run
    await agent_task_service.mark_completed(db, task, result)
    run.result_summary = result[-500:]
    await db.commit()
    await _notify_run_state(user_id)


async def _monitor(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
    adapter: OrcaAdapter,
    user_id: str,
    poll_interval: float,
    reconnect_grace_seconds: float,
    run_timeout_seconds: float,
) -> None:
    session_id = run.external_run_id
    if not session_id:
        raise RuntimeError("Orca chat id is missing")
    failures = 0
    max_failures = max(3, int(reconnect_grace_seconds / max(poll_interval, 0.05)))
    settled_polls = 0
    running_recorded = False
    started = time.monotonic()
    while True:
        if time.monotonic() - started > run_timeout_seconds:
            with suppress(OrcaError):
                await adapter.cancel(session_id)
            raise ValidationError(
                f"Orca did not finish within {run_timeout_seconds:g}s; the turn was stopped"
            )
        try:
            chat = await adapter.chat_state(session_id)
            failures = 0
        except OrcaError as exc:
            if exc.code not in _UNREACHABLE_CODES:
                raise ValidationError(exc.message) from exc
            failures += 1
            await db.refresh(run)
            if run.status == AgentRunStatus.CANCELLED:
                return
            run.heartbeat_at = datetime.now(timezone.utc)
            run.progress_message = f"Reconnecting to Orca ({failures}/{max_failures})"
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
                    f"Orca was unreachable for {reconnect_grace_seconds:g}s: {exc.message}",
                )
                await db.commit()
                await _notify_run_state(user_id)
                await discard_workspace(db, run=run, adapter=adapter, reason="failed")
                await db.commit()
                return
            await db.commit()
            await asyncio.sleep(poll_interval)
            continue

        await db.refresh(run)
        if run.status == AgentRunStatus.CANCELLED:
            return
        run.heartbeat_at = datetime.now(timezone.utc)
        metadata = _metadata(run)
        state = chat.state

        if state == "blocked":
            requests = await adapter.pending_requests(session_id)
            if requests:
                surfaced = [
                    {"id": request.item_id, "tool": request.title, "detail": request.detail[:2_000]}
                    for request in requests
                ]
                metadata.update(turn_seen=True, pending_requests=surfaced)
                _save_metadata(run, metadata)
                run.status = AgentRunStatus.WAITING_INPUT
                run.progress_message = f"Orca is waiting for approval: {requests[0].title}"[:500]
                task.status = "running"
                await agent_run_service.record_event(
                    db,
                    run,
                    "waiting_permission",
                    run.progress_message,
                    progress=run.progress,
                    payload={"permissions": surfaced},
                )
                await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
                await db.commit()
                await _notify_run_state(user_id)
                return

        if state in WORKING_STATES or state == "blocked":
            resumed_from_input = run.status == AgentRunStatus.WAITING_INPUT
            if not metadata.get("turn_seen"):
                metadata["turn_seen"] = True
                _save_metadata(run, metadata)
            run.status = AgentRunStatus.RUNNING
            run.progress = max(run.progress, 25)
            run.progress_message = (chat.last_message or "Orca agent is working")[:500]
            task.status = "running"
            task.progress = run.progress
            task.progress_message = run.progress_message
            if not running_recorded:
                await agent_run_service.record_event(
                    db,
                    run,
                    "provider_running",
                    f"Orca chat {session_id} is working",
                    progress=run.progress,
                    payload={"session_id": session_id},
                )
                running_recorded = True
            if resumed_from_input:
                await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
            await db.commit()
            await asyncio.sleep(poll_interval)
            continue

        if state == "error":
            transcript = await adapter.transcript(session_id, limit=10)
            message = transcript.reply_after_last_prompt() or chat.last_message
            raise ValidationError(f"Orca reported an error: {message or 'no details'}")

        if state in SETTLED_STATES:
            transcript = await adapter.transcript(session_id)
            if transcript.state in WORKING_STATES:
                await db.commit()
                await asyncio.sleep(poll_interval)
                continue
            answered = _answers_prompt(transcript.entries, metadata.get("prompt_head"))
            reply = transcript.reply_after_last_prompt() if answered else None
            if reply is not None:
                await _finish(db, run=run, task=task, adapter=adapter, reply=reply, user_id=user_id)
                return
            if metadata.get("turn_seen") and answered:
                settled_polls += 1
                if settled_polls >= SETTLED_WITHOUT_REPLY_POLLS:
                    await _finish(db, run=run, task=task, adapter=adapter, reply=None, user_id=user_id)
                    return
            # The prompt is journaled but the agent has not picked it up yet.
            await db.commit()
            await asyncio.sleep(poll_interval)
            continue

        run.progress_message = f"Orca chat state: {state}"
        await db.commit()
        await asyncio.sleep(poll_interval)


async def _send_prompt(
    db: AsyncSession,
    run: AgentRun,
    adapter: OrcaAdapter,
    text: str,
) -> None:
    """Set the permission mode, then send ``text`` as the chat's next message."""
    metadata = _metadata(run)
    await adapter.set_permission_mode(run.external_run_id or "", settings.orca_permission_mode)
    sent_at_ms = int(time.time() * 1000)
    await adapter.send(run.external_run_id or "", text)
    metadata.update(
        prompt_sent=True,
        prompt_head=_prompt_head(text),
        sent_at_ms=sent_at_ms,
        turn_seen=False,
        permission_mode=settings.orca_permission_mode,
        pending_requests=[],
    )
    _save_metadata(run, metadata)


async def execute_run(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: str,
    *,
    user_id: str = "user",
    adapter: OrcaAdapter | None = None,
    poll_interval: float | None = None,
    reconnect_grace_seconds: float | None = None,
) -> None:
    adapter = adapter or adapter_from_settings()
    poll_interval = poll_interval or settings.orca_poll_interval_seconds
    reconnect_grace_seconds = reconnect_grace_seconds or settings.orca_reconnect_grace_seconds
    async with session_factory() as db:
        try:
            run, task, project, todo = await _load_context(db, run_id)
            task._active_agent_run = run
            if run.status == AgentRunStatus.QUEUED:
                await agent_run_service.mark_starting(db, run)
                task.status = "running"
                await db.commit()
            metadata = _metadata(run)
            title = todo.title if todo else project.title
            if not run.workspace_id:
                workspace = await execution_host_service.resolve_workspace(db, project)
                problem = workspace_problem(workspace)
                if problem is not None:
                    raise ValidationError(problem[1])
                repo_path = os.path.expanduser(workspace.path or "")
                await adapter.ensure_repo(repo_path)
                if project.execution_workspace_isolation == "worktree":
                    try:
                        await sweep_pending_cleanups(session_factory, adapter=adapter)
                    except Exception:
                        logger.exception("Could not retry leftover Orca worktree cleanups")
                    worktree = await adapter.create_worktree(
                        repo_path=repo_path,
                        name=f"clawchat-{run.id[-8:]}",
                        branch=_branch_slug(title, run.id),
                        base_branch=project.execution_base_branch,
                    )
                    cwd, worktree_id, branch = worktree.path, worktree.id, worktree.branch
                else:
                    cwd, worktree_id, branch = repo_path, None, None
                run.workspace_id = cwd
                metadata.update(cwd=cwd, worktree_id=worktree_id, branch=branch)
                _save_metadata(run, metadata)
                await agent_run_service.record_event(
                    db,
                    run,
                    "workspace_created",
                    "Orca worktree created" if worktree_id else "Orca works in the project folder",
                    progress=5,
                    payload={"cwd": cwd, "worktree_id": worktree_id, "branch": branch},
                )
                await db.commit()
            if not run.external_run_id:
                agent = settings.orca_agent
                model = run.model or default_model(agent)
                session_id = await adapter.launch_chat(
                    worktree_path=run.workspace_id, agent=agent, model=model
                )
                run.external_run_id = session_id
                metadata = _metadata(run)
                metadata.update(session_id=session_id, agent=agent, model=model)
                _save_metadata(run, metadata)
                await agent_run_service.record_event(
                    db,
                    run,
                    "provider_started",
                    f"Orca {agent} chat {session_id} started",
                    progress=10,
                    payload={"session_id": session_id, "agent": agent, "model": model},
                )
                run.progress = 10
                run.progress_message = "Orca chat started"
                # Persist the external identity before any further call. A
                # crash from here is reattached on startup.
                await db.commit()
            if not _metadata(run).get("prompt_sent"):
                await _send_prompt(db, run, adapter, run.instruction_snapshot)
                if run.status == AgentRunStatus.STARTING:
                    await agent_run_service.mark_running(db, run)
                task.status = "running"
                await db.commit()
                await _notify_run_state(user_id)
            await _monitor(
                db,
                run=run,
                task=task,
                adapter=adapter,
                user_id=user_id,
                poll_interval=poll_interval,
                reconnect_grace_seconds=reconnect_grace_seconds,
                run_timeout_seconds=settings.orca_run_timeout_seconds,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Orca AgentRun %s failed", run_id)
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
                if run.status == AgentRunStatus.FAILED:
                    await discard_workspace(db, run=run, adapter=adapter, reason="failed")
                    await db.commit()
            except Exception:
                logger.exception("Could not persist Orca AgentRun failure for %s", run_id)


async def cancel_external_run(
    run: AgentRun,
    *,
    adapter: OrcaAdapter | None = None,
) -> str | None:
    """Stop the chat's turn in Orca; the error text when that could not be confirmed."""
    if run.provider != PROVIDER or not run.external_run_id:
        return None
    adapter = adapter or adapter_from_settings()
    try:
        await adapter.cancel(run.external_run_id)
        return None
    except OrcaError as exc:
        # Local cancellation must stay possible while Orca is down.
        logger.warning("Could not stop Orca chat %s: %s", run.external_run_id, exc)
        return exc.message


async def answer_pending_requests(
    run: AgentRun,
    *,
    allow: bool,
    adapter: OrcaAdapter | None = None,
) -> int:
    """Answer the approvals the run card showed; how many were answered.

    Only the requests ClawChat surfaced are answered, so one that appeared
    after the card was drawn is never approved unseen.
    """
    if run.provider != PROVIDER or not run.external_run_id:
        raise ConflictError("This run has no Orca chat")
    adapter = adapter or adapter_from_settings()
    shown = {item.get("id") for item in _metadata(run).get("pending_requests") or []}
    answered = 0
    try:
        for request in await adapter.pending_requests(run.external_run_id):
            if request.item_id in shown:
                await adapter.respond(run.external_run_id, request, allow=allow)
                answered += 1
    except OrcaError as exc:
        raise ConflictError(f"Orca could not take the answer: {exc.message}") from exc
    if answered == 0:
        raise ConflictError("The approval this run was waiting on is no longer pending in Orca")
    metadata = _metadata(run)
    metadata["pending_requests"] = []
    _save_metadata(run, metadata)
    return answered


async def resume_external_run(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: str,
    follow_up: str,
    *,
    user_id: str = "user",
    adapter: OrcaAdapter | None = None,
) -> None:
    """Send a follow-up to the same Orca chat and watch it again."""
    adapter = adapter or adapter_from_settings()
    async with session_factory() as db:
        run, task, _project, _todo = await _load_context(db, run_id)
        if run.provider != PROVIDER or not run.external_run_id:
            raise ConflictError("Orca chat identity is unavailable")
        try:
            # A follow-up instead of an answer declines what the agent asked for.
            for request in await adapter.pending_requests(run.external_run_id):
                with suppress(OrcaError):
                    await adapter.respond(run.external_run_id, request, allow=False)
            await _send_prompt(db, run, adapter, follow_up)
        except OrcaError as exc:
            # The resume already took the run out of waiting; leave it failed
            # with a retry rather than starting forever.
            task._active_agent_run = run
            await agent_task_service.mark_failed(
                db, task, f"Could not send the follow-up to Orca: {exc.message}"
            )
            await db.commit()
            await _notify_run_state(user_id)
            await discard_workspace(db, run=run, adapter=adapter, reason="failed")
            await db.commit()
            return
        run.status = AgentRunStatus.RUNNING
        run.progress = max(10, min(run.progress, 90))
        run.progress_message = "Follow-up sent to Orca"
        run.completed_at = None
        run.error = None
        task.status = "running"
        task.error = None
        await agent_run_service.record_event(
            db,
            run,
            "follow_up_sent",
            "Follow-up instruction sent to Orca",
            progress=run.progress,
        )
        await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
        await db.commit()
    await execute_run(session_factory, run_id, user_id=user_id, adapter=adapter)


async def recover_active_runs(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    adapter: OrcaAdapter | None = None,
) -> int:
    """Reattach a monitor to every Orca run that was executing before a restart."""
    adapter = adapter or adapter_from_settings()
    async with session_factory() as db:
        run_ids = list(
            (
                await db.execute(
                    select(AgentRun.id).where(
                        AgentRun.provider == PROVIDER,
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


async def _git(cwd: str, *args: str, check: bool = True) -> tuple[int, str]:
    process = await asyncio.create_subprocess_exec(
        "git",
        "-C",
        cwd,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.DEVNULL,
    )
    stdout, stderr = await process.communicate()
    output = (stdout or stderr).decode("utf-8", errors="replace").strip()
    if check and process.returncode != 0:
        raise RuntimeError(output or f"git {args[0]} exited with {process.returncode}")
    return process.returncode or 0, output


async def commit_all(cwd: str, message: str) -> str | None:
    """Commit everything in ``cwd``; the new commit, or None when nothing changed."""
    await _git(cwd, "add", "-A")
    unchanged, _ = await _git(cwd, "diff", "--cached", "--quiet", check=False)
    if unchanged == 0:
        return None
    identity: list[str] = []
    has_identity, _ = await _git(cwd, "var", "GIT_AUTHOR_IDENT", check=False)
    if has_identity != 0:
        # A machine with no git identity still gets its approved work kept.
        identity = ["-c", "user.name=ClawChat", "-c", "user.email=clawchat@localhost"]
    await _git(cwd, *identity, "commit", "--quiet", "-m", message)
    _, sha = await _git(cwd, "rev-parse", "HEAD")
    return sha


async def settle_workspace(
    db: AsyncSession,
    *,
    run: AgentRun,
    task: AgentTask,
    adopted: bool,
    adapter: OrcaAdapter | None = None,
) -> None:
    """After review: keep an approved worktree as a commit, remove a rejected one.

    Only a worktree ClawChat made is touched. With local isolation the agent
    worked in the person's own folder, which is theirs to commit or revert.
    A failure is recorded on the run and never undoes the decision.
    """
    if not adopted:
        await discard_workspace(db, run=run, adapter=adapter, reason="rejected")
        return
    metadata = _metadata(run)
    cwd = metadata.get("cwd") or run.workspace_id
    if not metadata.get("worktree_id") or not cwd:
        return
    branch = _branch_name(metadata)
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    title = todo.title if todo else task.task_type
    try:
        sha = await commit_all(cwd, f"{title}\n\nApproved in ClawChat (run {run.id})")
    except (OSError, RuntimeError) as exc:
        await agent_run_service.record_event(
            db, run, "commit_failed", f"Could not commit the approved changes: {exc}"[:500]
        )
        return
    if sha is None:
        return
    metadata["commit"] = sha
    _save_metadata(run, metadata)
    await agent_run_service.record_event(
        db,
        run,
        "changes_committed",
        f"Committed to {branch or cwd} ({sha[:7]})",
        payload={"branch": branch, "commit": sha, "cwd": cwd},
    )


_ENDED_REASONS = {AgentRunStatus.CANCELLED: "cancelled", AgentRunStatus.FAILED: "failed"}


def _branch_name(metadata: dict[str, Any]) -> str | None:
    return str(metadata.get("branch") or "").removeprefix("refs/heads/") or None


async def discard_workspace(
    db: AsyncSession,
    *,
    run: AgentRun,
    reason: str,
    adapter: OrcaAdapter | None = None,
    record_failure: bool = True,
) -> bool:
    """Remove the worktree ClawChat made for ``run``, and its branch.

    For work that will never be adopted: the review rejected it, or the run
    failed or was cancelled. Neither of those can be resumed, and a retry
    starts a new run in a new worktree, so nothing reaches the old one again.
    Changes the run has not recorded yet are kept as its patch first. A
    project folder (local isolation) is never touched.

    When Orca cannot remove it now, the run is marked ``cleanup_pending`` and
    the next Orca run retries it. True when nothing is left to remove.
    """
    metadata = _metadata(run)
    cwd = metadata.get("cwd") or run.workspace_id
    if not metadata.get("worktree_id") or not cwd or metadata.get("workspace_removed"):
        return True
    adapter = adapter or adapter_from_settings()
    branch = _branch_name(metadata)
    if "patch" not in metadata and os.path.isdir(cwd):
        try:
            files, patch = await collect_changes(adapter, cwd)
            metadata.update(files=files, patch=patch)
        except OrcaError:
            pass
    try:
        await adapter.remove_worktree(cwd, delete_branch=True)
    except OrcaError as exc:
        if os.path.isdir(cwd):
            metadata["cleanup_pending"] = True
            _save_metadata(run, metadata)
            if record_failure:
                await agent_run_service.record_event(
                    db,
                    run,
                    "workspace_cleanup_failed",
                    (
                        f"Could not remove the Orca worktree yet ({exc.message}); "
                        "the next Orca run retries it"
                    )[:500],
                    payload={"branch": branch, "cwd": cwd},
                )
            return False
        # Someone already removed the folder; there is nothing left to retry.
    metadata["workspace_removed"] = True
    metadata.pop("cleanup_pending", None)
    _save_metadata(run, metadata)
    await agent_run_service.record_event(
        db,
        run,
        "workspace_removed",
        f"Removed the {reason} run's worktree{f' and branch {branch}' if branch else ''}",
        payload={"branch": branch, "cwd": cwd, "reason": reason},
    )
    return True


async def stop_cancelled_run(
    db: AsyncSession,
    run: AgentRun,
    *,
    adapter: OrcaAdapter | None = None,
) -> None:
    """After a person cancels a run: stop its turn in Orca and drop its worktree."""
    if run.provider != PROVIDER:
        return
    adapter = adapter or adapter_from_settings()
    error = await cancel_external_run(run, adapter=adapter)
    if error:
        await agent_run_service.record_event(
            db, run, "external_cancel_unconfirmed", error, progress=run.progress
        )
    await discard_workspace(db, run=run, adapter=adapter, reason="cancelled")
    await db.commit()


async def sweep_pending_cleanups(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    adapter: OrcaAdapter,
) -> int:
    """Remove worktrees still left by runs that ended; how many were removed.

    Covers a removal Orca could not do when the run ended
    (``cleanup_pending``), and a run the watchdog failed after its monitor
    was gone, which never got to remove anything.
    """
    removed = 0
    async with session_factory() as db:
        runs = (
            await db.execute(
                select(AgentRun).where(
                    AgentRun.provider == PROVIDER,
                    # Serialized by _save_metadata; a null worktree_id is local isolation.
                    AgentRun.usage_json.like('%"worktree_id": "%'),
                    AgentRun.usage_json.not_like('%"workspace_removed": true%'),
                    or_(
                        AgentRun.status.in_(tuple(_ENDED_REASONS)),
                        AgentRun.usage_json.like('%"cleanup_pending": true%'),
                    ),
                )
            )
        ).scalars()
        for run in runs:
            reason = _ENDED_REASONS.get(run.status, "rejected")
            if await discard_workspace(
                db, run=run, adapter=adapter, reason=reason, record_failure=False
            ):
                removed += 1
        await db.commit()
    return removed


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
    metadata = _metadata(run)
    todo = await db.get(Todo, task.todo_id) if task.todo_id else None
    await artifact_service.create_artifact(
        db,
        project_id=run.project_id,
        task_id=task.todo_id,
        type=ArtifactType.CODE_DIFF,
        title=f"Orca changes · {todo.title if todo else task.task_type}",
        content=metadata.get("patch") or run.result or "",
        source=PROVIDER,
        created_by=run.id,
    )
