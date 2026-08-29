import asyncio
import base64
import json
import logging
from contextlib import suppress
from typing import Any
from urllib.parse import quote

import httpx
from websockets.asyncio.client import connect

from auth.dependencies import validate_principal
from auth.jwt import decode_token_any
from database import async_session_factory
from services.relay.host_identity import get_or_create_host_identity
from services.relay.relay_crypto import RelayCipher
from ws.manager import ConnectionManager

logger = logging.getLogger(__name__)


def relay_websocket_url(relay_url: str, role: str, host_id: str) -> str:
    base = relay_url.rstrip("/").replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    return f"{base}/v1/relay/{role}/{quote(host_id, safe='')}"


class RelayTransport:
    def __init__(self, connector: "RelayHostConnector", client_id: str):
        self.connector = connector
        self.client_id = client_id

    async def send_json(self, data: dict) -> None:
        await self.connector.send_encrypted(self.client_id, {"type": "event", "data": data})

    async def close(self, code: int = 4001, reason: str = "Session revoked") -> None:
        with suppress(Exception):
            await self.connector.send_encrypted(
                self.client_id,
                {"type": "auth_error", "code": code, "reason": reason},
            )
        await self.connector._drop_client(self.client_id)


class RelayHostConnector:
    def __init__(self, relay_url: str, port: int, ws_manager: ConnectionManager):
        self.relay_url = relay_url
        self.local_base_url = f"http://127.0.0.1:{port}"
        self.ws_manager = ws_manager
        self.host_id = ""
        self.private_key = ""
        self.ciphers: dict[str, RelayCipher] = {}
        self.transports: dict[str, tuple[str, RelayTransport]] = {}
        self._socket: Any = None
        self._send_lock = asyncio.Lock()
        self._stopping = asyncio.Event()
        self._http = httpx.AsyncClient(base_url=self.local_base_url, timeout=120)

    async def load_identity(self) -> None:
        async with async_session_factory() as db:
            identity = await get_or_create_host_identity(db)
            await db.commit()
            self.host_id = identity.host_id
            self.private_key = identity.private_key

    async def run_forever(self) -> None:
        await self.load_identity()
        delay = 1
        while not self._stopping.is_set():
            url = relay_websocket_url(self.relay_url, "host", self.host_id)
            try:
                async with connect(url, ping_interval=20, ping_timeout=20) as websocket:
                    self._socket = websocket
                    delay = 1
                    logger.info("Connected to ClawChat relay as %s", self.host_id)
                    async for raw in websocket:
                        message = json.loads(raw)
                        await self._handle_broker_message(message)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Relay connection failed: %s", error)
            finally:
                self._socket = None
                await self._clear_clients()
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)
            except TimeoutError:
                pass
            delay = min(delay * 2, 30)

    async def stop(self) -> None:
        self._stopping.set()
        if self._socket is not None:
            await self._socket.close()
        await self._clear_clients()
        await self._http.aclose()

    async def _handle_broker_message(self, message: dict) -> None:
        client_id = message.get("client_id")
        if not client_id:
            return
        if message.get("type") == "client_disconnected":
            await self._drop_client(client_id)
            return
        if message.get("type") != "client_frame":
            return
        frame = message.get("payload") or {}
        if frame.get("kind") == "hello":
            try:
                cipher = RelayCipher(
                    self.private_key,
                    frame["client_public_key"],
                    self.host_id,
                )
                self.ciphers[client_id] = cipher
                await self.send_encrypted(
                    client_id,
                    {"type": "ready", "host_id": self.host_id, "protocol_version": 1},
                )
            except Exception as error:
                logger.warning("Rejected relay handshake for %s: %s", client_id, error)
            return

        cipher = self.ciphers.get(client_id)
        if cipher is None:
            return
        try:
            payload = cipher.decrypt(frame)
        except Exception as error:
            logger.warning("Rejected encrypted relay frame for %s: %s", client_id, error)
            return
        message_type = payload.get("type")
        if message_type == "http_request":
            asyncio.create_task(self._handle_http_request(client_id, payload))
        elif message_type == "subscribe":
            await self._handle_subscribe(client_id, payload)
        elif message_type == "unsubscribe":
            await self._drop_subscription(client_id)

    async def _handle_http_request(self, client_id: str, payload: dict) -> None:
        request_id = payload.get("id")
        try:
            path = str(payload.get("path", ""))
            if not path.startswith("/api/") or path.startswith("//"):
                raise ValueError("Relay requests are limited to /api paths")
            headers = {
                key: value
                for key, value in (payload.get("headers") or {}).items()
                if key.lower() in {"authorization", "accept", "content-type"}
            }
            body = base64.b64decode(payload.get("body", "")) if payload.get("body") else b""
            response = await self._http.request(
                str(payload.get("method", "GET")).upper(),
                path,
                headers=headers,
                content=body,
            )
            result = {
                "type": "http_response",
                "id": request_id,
                "status": response.status_code,
                "headers": {"content-type": response.headers.get("content-type", "")},
                "body": base64.b64encode(response.content).decode("ascii"),
            }
        except Exception as error:
            result = {
                "type": "http_response",
                "id": request_id,
                "status": 502,
                "headers": {"content-type": "application/json"},
                "body": base64.b64encode(
                    json.dumps({"detail": f"Relay request failed: {error}"}).encode("utf-8")
                ).decode("ascii"),
            }
        with suppress(Exception):
            await self.send_encrypted(client_id, result)

    async def _handle_subscribe(self, client_id: str, payload: dict) -> None:
        try:
            token_payload = decode_token_any(payload.get("token", ""))
            async with async_session_factory() as db:
                principal = await validate_principal(token_payload, db)
            await self._drop_subscription(client_id)
            transport = RelayTransport(self, client_id)
            self.transports[client_id] = (principal.subject, transport)
            self.ws_manager.register(principal.subject, transport)
            await self.send_encrypted(client_id, {"type": "subscribed"})
        except Exception:
            await self.send_encrypted(client_id, {"type": "auth_error"})

    async def send_encrypted(self, client_id: str, payload: dict) -> None:
        cipher = self.ciphers.get(client_id)
        if cipher is None or self._socket is None:
            raise ConnectionError("Relay client is not connected")
        message = {"client_id": client_id, "payload": cipher.encrypt(payload)}
        async with self._send_lock:
            await self._socket.send(json.dumps(message, separators=(",", ":")))

    async def _drop_subscription(self, client_id: str) -> None:
        subscription = self.transports.pop(client_id, None)
        if subscription is not None:
            user_id, transport = subscription
            self.ws_manager.disconnect(user_id, transport)

    async def _drop_client(self, client_id: str) -> None:
        await self._drop_subscription(client_id)
        self.ciphers.pop(client_id, None)

    async def _clear_clients(self) -> None:
        for client_id in list(self.ciphers):
            await self._drop_client(client_id)
