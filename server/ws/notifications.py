"""Shared WebSocket cache-invalidation notifications."""

import asyncio
from collections.abc import Awaitable, Callable

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from ws.manager import ws_manager

DEFAULT_USER_ID = "user"


def notify_after_commit(
    db: AsyncSession,
    payload: dict,
    user_id: str = DEFAULT_USER_ID,
    *,
    send_json: Callable[[str, dict], Awaitable[None]] | None = None,
) -> None:
    """Push ``payload`` once the session's current transaction has committed.

    A client that refetches on a push must find the row the push is about.
    Services write and notify before their caller commits, so pushing at once
    lets the refetch race the commit; this waits for the commit instead.
    """
    loop = asyncio.get_running_loop()
    sender = send_json or ws_manager.send_json

    def _fire(_session) -> None:
        loop.create_task(sender(user_id, payload))

    event.listen(db.sync_session, "after_commit", _fire, once=True)


async def notify_module_data_changed(
    module: str,
    user_id: str = DEFAULT_USER_ID,
) -> None:
    """Tell a user's clients to refresh one cached data module."""
    await ws_manager.send_json(
        user_id,
        {
            "type": "module_data_changed",
            "data": {"module": module},
        },
    )
