"""Shared WebSocket cache-invalidation notifications."""

from ws.manager import ws_manager

DEFAULT_USER_ID = "user"


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
