import json

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from services.relay_connector import RelayHostConnector
from services.relay_crypto import RelayCipher, encode_bytes
from ws.manager import ConnectionManager


def keypair() -> tuple[str, str]:
    private = X25519PrivateKey.generate()
    return (
        encode_bytes(private.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )),
        encode_bytes(private.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )),
    )


class FakeSocket:
    def __init__(self):
        self.messages: list[dict] = []

    async def send(self, raw: str):
        self.messages.append(json.loads(raw))

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_connector_handshake_and_http_tunnel():
    host_private, host_public = keypair()
    client_private, client_public = keypair()
    connector = RelayHostConnector("http://relay", 8000, ConnectionManager())
    await connector._http.aclose()
    connector._http = httpx.AsyncClient(
        base_url="http://local",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"path": request.url.path})
        ),
    )
    connector.host_id = "claw_test"
    connector.private_key = host_private
    connector._socket = FakeSocket()
    client_cipher = RelayCipher(client_private, host_public, connector.host_id)

    await connector._handle_broker_message({
        "type": "client_frame",
        "client_id": "mobile-1",
        "payload": {"kind": "hello", "client_public_key": client_public},
    })
    ready_frame = connector._socket.messages.pop()["payload"]
    assert client_cipher.decrypt(ready_frame)["type"] == "ready"

    await connector._handle_http_request("mobile-1", {
        "type": "http_request",
        "id": "request-1",
        "method": "GET",
        "path": "/api/health",
    })
    response_frame = connector._socket.messages.pop()["payload"]
    response = client_cipher.decrypt(response_frame)
    assert response["type"] == "http_response"
    assert response["status"] == 200

    await connector.stop()


@pytest.mark.asyncio
async def test_connector_rejects_non_api_proxy_paths():
    host_private, host_public = keypair()
    client_private, client_public = keypair()
    connector = RelayHostConnector("http://relay", 8000, ConnectionManager())
    connector.host_id = "claw_test"
    connector.private_key = host_private
    connector._socket = FakeSocket()
    connector.ciphers["mobile-1"] = RelayCipher(host_private, client_public, connector.host_id)
    client_cipher = RelayCipher(client_private, host_public, connector.host_id)

    await connector._handle_http_request("mobile-1", {
        "type": "http_request",
        "id": "bad-request",
        "method": "GET",
        "path": "http://metadata.internal/",
    })

    response = client_cipher.decrypt(connector._socket.messages.pop()["payload"])
    assert response["status"] == 502
    await connector.stop()
