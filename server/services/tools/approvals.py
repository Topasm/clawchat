"""Pause a run until the user allows or denies one tool call.

The waiting side holds an in-memory future. The decision endpoint resolves it;
if nothing is waiting (the server restarted, or the wait timed out), the
request is over and the endpoint says so.
"""

import asyncio
import json
from datetime import datetime, timezone

from domain.agent_run import AgentRunStatus
from domain.agent_tools import ToolDecision
from exceptions import ConflictError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from services.agents import agent_run_service
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed

APPROVAL_TIMEOUT_SECONDS = 30 * 60.0
_ARGUMENT_PREVIEW_CHARS = 300

_waiting: dict[str, tuple[str, asyncio.Future[ToolDecision]]] = {}


def pending_call_for_run(run_id: str) -> str | None:
    for call_id, (waiting_run_id, future) in _waiting.items():
        if waiting_run_id == run_id and not future.done():
            return call_id
    return None


def _preview(arguments: dict) -> str:
    text = json.dumps(arguments, ensure_ascii=False)
    if len(text) > _ARGUMENT_PREVIEW_CHARS:
        text = text[:_ARGUMENT_PREVIEW_CHARS] + "…"
    return text


async def _set_run_waiting(
    db: AsyncSession, run_id: str, *, waiting: bool, message: str, event: str
) -> None:
    run = await db.get(AgentRun, run_id)
    if run is None:
        return
    if waiting and run.status not in (AgentRunStatus.RUNNING, AgentRunStatus.STARTING):
        return
    if not waiting and run.status != AgentRunStatus.WAITING_INPUT:
        return
    run.status = AgentRunStatus.WAITING_INPUT if waiting else AgentRunStatus.RUNNING
    run.progress_message = message
    # The wait may be long; the watchdog must not read it as silence afterwards.
    run.heartbeat_at = datetime.now(timezone.utc)
    task = await db.get(AgentTask, run.agent_task_id)
    await agent_run_service.record_event(db, run, event, message, progress=run.progress)
    await agent_run_service.notify_run_state(db, run, task)
    await db.commit()
    await notify_module_data_changed("runs")


async def request_decision(
    db: AsyncSession,
    *,
    run_id: str,
    call_id: str,
    tool_name: str,
    arguments: dict,
    timeout: float = APPROVAL_TIMEOUT_SECONDS,
) -> ToolDecision:
    """Park the run until the user decides; a timeout counts as a denial."""
    future: asyncio.Future[ToolDecision] = asyncio.get_running_loop().create_future()
    _waiting[call_id] = (run_id, future)
    try:
        await _set_run_waiting(
            db,
            run_id,
            waiting=True,
            message=f"Wants to use {tool_name} with {_preview(arguments)}",
            event="waiting_permission",
        )
        try:
            decision = await asyncio.wait_for(asyncio.shield(future), timeout)
        except TimeoutError:
            decision = ToolDecision.DENY
    finally:
        _waiting.pop(call_id, None)
    await _set_run_waiting(
        db,
        run_id,
        waiting=False,
        message=f"Tool {tool_name} {'allowed' if decision == ToolDecision.ALLOW else 'denied'}",
        event=(
            "permission_allowed" if decision == ToolDecision.ALLOW else "permission_denied"
        ),
    )
    return decision


def decide(run_id: str, call_id: str, decision: ToolDecision) -> None:
    waiting = _waiting.get(call_id)
    if waiting is None or waiting[0] != run_id or waiting[1].done():
        raise ConflictError("This tool request is no longer waiting for a decision")
    waiting[1].set_result(decision)
