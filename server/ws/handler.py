import asyncio
import logging

from fastapi import Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import validate_principal
from auth.jwt import decode_token_any
from database import get_db
from exceptions import UnauthorizedError
from ws.manager import ws_manager

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL = 15  # seconds — keep connection alive through proxies


async def websocket_endpoint(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
):
    # New clients exchange their bearer token for a short-lived ticket first.
    # The legacy token parameter remains during the mobile migration window.
    credential = websocket.query_params.get("ticket")
    expected_types = {"ws_ticket"}
    if not credential:
        credential = websocket.query_params.get("token")
        expected_types = {"access", "device"}
    if not credential:
        await websocket.close(code=4001, reason="Missing WebSocket ticket")
        return

    try:
        payload = decode_token_any(credential, allowed_types=expected_types)
        if payload["type"] == "ws_ticket":
            principal_payload = {
                "sub": payload["sub"],
                "type": payload.get("principal_type"),
            }
        else:
            principal_payload = payload
        principal = await validate_principal(principal_payload, db)
        user_id = principal.subject
    except UnauthorizedError:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await ws_manager.connect(websocket, user_id)
    logger.info("WebSocket connected: %s", user_id)

    async def _heartbeat():
        """Send periodic heartbeat to keep the connection alive through proxies."""
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                await websocket.send_json({"type": "heartbeat"})
        except Exception:
            pass  # Connection closed; task will be cancelled

    heartbeat_task = asyncio.create_task(_heartbeat())

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg_type == "typing":
                pass  # Typing indicators — no server action needed for single-user
            else:
                logger.warning("Unknown WS message type: %s", msg_type)
    except WebSocketDisconnect:
        ws_manager.disconnect(user_id, websocket)
        logger.info("WebSocket disconnected: %s", user_id)
    except Exception:
        ws_manager.disconnect(user_id, websocket)
        logger.exception("WebSocket error for user %s", user_id)
    finally:
        heartbeat_task.cancel()
