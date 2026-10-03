"""Phone pushes for agent runs that stopped and need the user.

``agent_run_service.notify_run_state`` already tells open clients about every
run transition over the WebSocket. A phone in a pocket has no socket, so the
transitions that need a person -- the run is waiting for input, waiting for
review, or failed -- also go out as an FCM push.

The push is data-only: the app builds the notification itself, in the user's
language, and routes a tap to the run. Each (run, status) pair is pushed at
most once, so a status written twice does not buzz twice.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from typing import Any

from domain.agent_run import AgentRunStatus

logger = logging.getLogger(__name__)

PUSH_STATUSES = frozenset(
    {AgentRunStatus.WAITING_INPUT, AgentRunStatus.WAITING_REVIEW, AgentRunStatus.FAILED}
)

#: How many recent (run, status) pairs to remember for de-duplication.
_SENT_MEMORY = 512

_push_service: Any | None = None
_session_factory: Any | None = None
_sent: OrderedDict[tuple[str, str], None] = OrderedDict()


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
    if not run_id or status not in PUSH_STATUSES:
        return None
    data = {
        "type": "run_state",
        "status": status,
        "run_id": str(run_id),
        "title": str(payload.get("title") or "")[:200],
    }
    for key in ("todo_id", "conversation_id", "review_id"):
        value = payload.get(key)
        if value:
            data[key] = str(value)
    if status == AgentRunStatus.FAILED and payload.get("error"):
        data["detail"] = str(payload["error"])[:300]
    return data


def _first_time(run_id: str, status: str) -> bool:
    key = (run_id, status)
    if key in _sent:
        return False
    _sent[key] = None
    while len(_sent) > _SENT_MEMORY:
        _sent.popitem(last=False)
    return True


async def send_for_run_state(_user_id: str, message: dict[str, Any]) -> None:
    """``notify_after_commit`` sender: push the run's state if it needs the user."""
    if not enabled():
        return
    data = push_data(message.get("data") or {})
    if data is None or not _first_time(data["run_id"], data["status"]):
        return
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
    configure(None, None)


__all__ = [
    "PUSH_STATUSES",
    "configure",
    "enabled",
    "push_data",
    "schedule",
    "send_for_run_state",
]
