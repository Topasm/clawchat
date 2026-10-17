"""Phone pushes for agent runs that stopped and need the user.

``agent_run_service.notify_run_state`` already tells open clients about every
run transition over the WebSocket. A phone in a pocket has no socket, so the
transitions that need a person -- the run is waiting for input, waiting for
review, or failed -- also go out as an FCM push.

The push is data-only: the app builds the notification itself, in the user's
language, and routes a tap to the run. It carries what the notification shows
without a round trip: the agent's question, the result's risk, the machine,
the step and when the run started. Each state of a run is pushed once, so a
status written twice does not buzz twice; a second wait on the same run, or
the reminder about a wait nobody answered, is a new state and pushes again.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from domain.agent_run import AgentRunStatus

logger = logging.getLogger(__name__)

PUSH_STATUSES = frozenset(
    {AgentRunStatus.WAITING_INPUT, AgentRunStatus.WAITING_REVIEW, AgentRunStatus.FAILED}
)
#: Also pushed, silently: the phone keeps one quiet "working" notification per
#: top-level run and swaps it for the result, so a pocket knows what Home is
#: doing without a top bar. Nothing is sent for a sub-task's run.
PROGRESS_STATUSES = frozenset(
    {AgentRunStatus.RUNNING, AgentRunStatus.COMPLETED, AgentRunStatus.CANCELLED}
)

#: A running run's bar moves on the phone at most this often.
PROGRESS_PUSH_INTERVAL_SECONDS = 60.0

#: How many recent run states to remember for de-duplication.
_SENT_MEMORY = 512

_push_service: Any | None = None
_session_factory: Any | None = None
_sent: OrderedDict[tuple[str, str], None] = OrderedDict()
_progress_pushed_at: OrderedDict[str, float] = OrderedDict()


def configure(push_service: Any | None, session_factory: Any | None) -> None:
    """Called once at startup; without it (tests, push disabled) nothing is sent."""
    global _push_service, _session_factory
    _push_service = push_service
    _session_factory = session_factory


def enabled() -> bool:
    return (
        _push_service is not None
        and _session_factory is not None
        and bool(getattr(_push_service, "enabled", False))
    )


def push_data(payload: dict[str, Any]) -> dict[str, str] | None:
    """The FCM data for a ``run_state_changed`` payload, or None when it needs no push."""
    status = str(payload.get("status") or "")
    run_id = payload.get("run_id")
    if not run_id:
        return None
    if status in PROGRESS_STATUSES:
        if payload.get("parent_task_id"):
            return None
    elif status not in PUSH_STATUSES:
        return None
    data = {
        "type": "run_state",
        "status": status,
        "run_id": str(run_id),
        "title": str(payload.get("title") or "")[:200],
    }
    for key in ("todo_id", "conversation_id", "review_id", "risk_level", "host_label"):
        value = payload.get(key)
        if value:
            data[key] = str(value)[:200]
    if status == AgentRunStatus.FAILED and payload.get("error"):
        data["detail"] = str(payload["error"])[:300]
    elif status == AgentRunStatus.WAITING_INPUT and payload.get("progress_message"):
        # The question itself, so the notification asks it.
        data["detail"] = str(payload["progress_message"])[:300]
    elif status == AgentRunStatus.WAITING_REVIEW and payload.get("result_summary"):
        data["detail"] = str(payload["result_summary"])[:300]
    if status == AgentRunStatus.RUNNING:
        started_ms = _epoch_millis(payload.get("started_at"))
        if started_ms is not None:
            data["started_at_ms"] = str(started_ms)
        progress = payload.get("progress")
        if isinstance(progress, int) and 0 < progress <= 100:
            data["progress"] = str(progress)
        if payload.get("step") and payload.get("step_count"):
            data["step"] = str(payload["step"])
            data["step_count"] = str(payload["step_count"])
    if payload.get("reminder"):
        data["reminder"] = "1"
    if payload.get("progress_update"):
        data["progress_update"] = "1"
    data["push_key"] = _push_key(status, payload)
    return data


def _epoch_millis(value: Any) -> int | None:
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and value:
        try:
            moment = datetime.fromisoformat(value)
        except ValueError:
            return None
    else:
        return None
    if moment.tzinfo is None:
        # The database hands timestamps back without a zone; they are UTC.
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def _push_key(status: str, payload: dict[str, Any]) -> str:
    """Names one state of a run: the status, when it began, and whether it is the reminder."""
    key = f"{status}@{payload.get('status_since') or ''}"
    return f"{key}:reminder" if payload.get("reminder") else key


def _first_time(run_id: str, key: str) -> bool:
    entry = (run_id, key)
    if entry in _sent:
        return False
    _sent[entry] = None
    while len(_sent) > _SENT_MEMORY:
        _sent.popitem(last=False)
    return True


def progress_due(run_id: str, *, now: float | None = None) -> bool:
    """Whether a running run's progress may go to the phone again yet."""
    if not enabled():
        return False
    last = _progress_pushed_at.get(run_id)
    now = time.monotonic() if now is None else now
    return last is None or now - last >= PROGRESS_PUSH_INTERVAL_SECONDS


def _mark_progress(run_id: str) -> None:
    _progress_pushed_at[run_id] = time.monotonic()
    _progress_pushed_at.move_to_end(run_id)
    while len(_progress_pushed_at) > _SENT_MEMORY:
        _progress_pushed_at.popitem(last=False)


async def send_for_run_state(_user_id: str, message: dict[str, Any]) -> None:
    """``notify_after_commit`` sender: push the run's state if it needs the user."""
    if not enabled():
        return
    data = push_data(message.get("data") or {})
    if data is None:
        return
    if data.get("progress_update"):
        # Progress has no state of its own; it is only ever too soon.
        if not progress_due(data["run_id"]):
            return
        _mark_progress(data["run_id"])
    elif not _first_time(data["run_id"], data["push_key"]):
        return
    elif data["status"] == AgentRunStatus.RUNNING:
        _mark_progress(data["run_id"])
    try:
        async with _session_factory() as db:
            await _push_service.send_to_all_devices(db, data=data, data_only=True)
    except Exception:
        logger.exception("Could not push run %s (%s)", data["run_id"], data["status"])


def schedule(db, payload: dict[str, Any]) -> None:
    """Queue the push to go out after the caller's transaction commits."""
    if not enabled() or push_data(payload) is None:
        return
    from ws.notifications import notify_after_commit

    try:
        notify_after_commit(
            db,
            {"type": "run_state_changed", "data": payload},
            send_json=send_for_run_state,
        )
    except RuntimeError:
        # No running loop (sync callers in tests): nothing to schedule on.
        logger.debug("No event loop for run push; skipped")


def _reset_for_tests() -> None:
    _sent.clear()
    _progress_pushed_at.clear()
    configure(None, None)


__all__ = [
    "PROGRESS_STATUSES",
    "PUSH_STATUSES",
    "configure",
    "enabled",
    "progress_due",
    "push_data",
    "schedule",
    "send_for_run_state",
]
