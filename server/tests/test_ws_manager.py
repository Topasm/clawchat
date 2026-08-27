import pytest

from ws.manager import ConnectionManager


class ClosingTransport:
    def __init__(self):
        self.closed = False

    async def send_json(self, data: dict):
        pass

    async def close(self, code: int, reason: str):
        self.closed = code == 4001 and reason == "Device revoked"


@pytest.mark.asyncio
async def test_close_user_removes_and_closes_all_transports():
    manager = ConnectionManager()
    first = ClosingTransport()
    second = ClosingTransport()
    manager.register("device-1", first)
    manager.register("device-1", second)

    await manager.close_user("device-1", reason="Device revoked")

    assert first.closed is True
    assert second.closed is True
    assert "device-1" not in manager.active_connections
