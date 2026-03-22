import logging
from collections.abc import AsyncIterator

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket | None = None):
        conns = self.active_connections.get(user_id)
        if not conns:
            return
        if websocket:
            conns[:] = [ws for ws in conns if ws is not websocket]
            if not conns:
                del self.active_connections[user_id]
        else:
            del self.active_connections[user_id]

    async def send_json(self, user_id: str, data: dict):
        conns = self.active_connections.get(user_id)
        if not conns:
            return
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                logger.warning("Failed to send WS message to %s, removing connection", user_id)
                dead.append(ws)
        if dead:
            conns[:] = [ws for ws in conns if ws not in dead]
            if not conns:
                del self.active_connections[user_id]

    async def stream_to_user(
        self,
        user_id: str,
        message_id: str,
        conversation_id: str,
        token_iterator: AsyncIterator[str],
    ) -> str:
        await self.send_json(user_id, {
            "type": "stream_start",
            "data": {"message_id": message_id, "conversation_id": conversation_id},
        })

        full_content = ""
        index = 0
        async for token in token_iterator:
            full_content += token
            await self.send_json(user_id, {
                "type": "stream_chunk",
                "data": {"message_id": message_id, "content": token, "index": index},
            })
            index += 1

        await self.send_json(user_id, {
            "type": "stream_end",
            "data": {"message_id": message_id, "full_content": full_content},
        })

        return full_content


ws_manager = ConnectionManager()
