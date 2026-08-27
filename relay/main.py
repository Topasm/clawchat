import asyncio
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect


app = FastAPI(title="ClawChat Relay", version="0.1.0")


class RelayBroker:
    def __init__(self) -> None:
        self.hosts: dict[str, WebSocket] = {}
        self.clients: dict[str, dict[str, WebSocket]] = {}
        self._host_locks: dict[str, asyncio.Lock] = {}

    async def attach_host(self, host_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        previous = self.hosts.get(host_id)
        if previous is not None:
            await previous.close(code=4002, reason="Host replaced by a new connection")
        self.hosts[host_id] = websocket
        self.clients.setdefault(host_id, {})
        self._host_locks.setdefault(host_id, asyncio.Lock())

    async def detach_host(self, host_id: str, websocket: WebSocket) -> None:
        if self.hosts.get(host_id) is websocket:
            self.hosts.pop(host_id, None)
            for client in list(self.clients.get(host_id, {}).values()):
                await client.close(code=4004, reason="Host disconnected")
            self.clients.pop(host_id, None)
            self._host_locks.pop(host_id, None)

    async def send_to_host(self, host_id: str, message: dict) -> bool:
        host = self.hosts.get(host_id)
        lock = self._host_locks.get(host_id)
        if host is None or lock is None:
            return False
        async with lock:
            await host.send_json(message)
        return True


broker = RelayBroker()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "hosts": len(broker.hosts),
        "clients": sum(len(items) for items in broker.clients.values()),
    }


@app.websocket("/v1/relay/host/{host_id}")
async def host_socket(websocket: WebSocket, host_id: str):
    await broker.attach_host(host_id, websocket)
    try:
        while True:
            message = await websocket.receive_json()
            client_id = message.get("client_id")
            payload = message.get("payload")
            client = broker.clients.get(host_id, {}).get(client_id)
            if client is not None and isinstance(payload, dict):
                await client.send_json(payload)
    except WebSocketDisconnect:
        pass
    finally:
        await broker.detach_host(host_id, websocket)


@app.websocket("/v1/relay/client/{host_id}")
async def client_socket(websocket: WebSocket, host_id: str):
    await websocket.accept()
    if host_id not in broker.hosts:
        await websocket.send_json({"kind": "host_offline"})
        await websocket.close(code=4004, reason="Host is offline")
        return

    client_id = str(uuid.uuid4())
    broker.clients.setdefault(host_id, {})[client_id] = websocket
    await broker.send_to_host(host_id, {"type": "client_connected", "client_id": client_id})
    try:
        while True:
            payload = await websocket.receive_json()
            if isinstance(payload, dict):
                await broker.send_to_host(
                    host_id,
                    {"type": "client_frame", "client_id": client_id, "payload": payload},
                )
    except WebSocketDisconnect:
        pass
    finally:
        broker.clients.get(host_id, {}).pop(client_id, None)
        await broker.send_to_host(
            host_id,
            {"type": "client_disconnected", "client_id": client_id},
        )
