import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.testclient import TestClient

from main import app
from models.paired_device import PairedDevice
from auth.jwt import decode_token_any, hash_device_token


async def _pair_device(client: AsyncClient, auth_headers: dict) -> dict:
    """Helper: create a pairing session and claim it, return claim response data."""
    session_resp = await client.post("/api/pairing/session", headers=auth_headers)
    code = session_resp.json()["code"]
    claim_resp = await client.post("/api/pairing/claim", json={
        "code": code,
        "device_name": "Test Android",
        "device_type": "android",
    })
    return claim_resp.json()


@pytest.mark.asyncio
async def test_device_token_accesses_protected_endpoint(client: AsyncClient, auth_headers: dict):
    """A paired device's token should work on protected endpoints."""
    claim = await _pair_device(client, auth_headers)
    device_headers = {"Authorization": f"Bearer {claim['device_token']}"}

    resp = await client.get("/api/todos", headers=device_headers)
    # Should succeed (200) or return empty list, not 401/403
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_device_token_is_only_stored_as_a_hash(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
):
    claim = await _pair_device(client, auth_headers)

    result = await db_session.execute(
        select(PairedDevice).where(PairedDevice.id == claim["device_id"])
    )
    device = result.scalar_one()

    assert device.device_token != claim["device_token"]
    assert device.device_token == hash_device_token(claim["device_token"])


@pytest.mark.asyncio
async def test_replaced_device_token_hash_is_rejected(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
):
    claim = await _pair_device(client, auth_headers)
    result = await db_session.execute(
        select(PairedDevice).where(PairedDevice.id == claim["device_id"])
    )
    device = result.scalar_one()
    device.device_token = hash_device_token("replacement-token")
    await db_session.commit()

    response = await client.get(
        "/api/todos",
        headers={"Authorization": f"Bearer {claim['device_token']}"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_revoked_device_token_is_rejected(client: AsyncClient, auth_headers: dict):
    """After revoking a device, its token should be rejected."""
    claim = await _pair_device(client, auth_headers)
    device_headers = {"Authorization": f"Bearer {claim['device_token']}"}

    # Verify access works before revoke
    resp = await client.get("/api/todos", headers=device_headers)
    assert resp.status_code == 200

    # Revoke the device
    await client.delete(f"/api/pairing/devices/{claim['device_id']}", headers=auth_headers)

    # Access should now fail
    resp = await client.get("/api/todos", headers=device_headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_device_auth_updates_last_seen(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    """Each authenticated request from a device should update last_seen."""
    claim = await _pair_device(client, auth_headers)
    device_headers = {"Authorization": f"Bearer {claim['device_token']}"}

    # Make a request to update last_seen
    await client.get("/api/todos", headers=device_headers)

    # Check last_seen was updated (it should be recent)
    result = await db_session.execute(
        select(PairedDevice).where(PairedDevice.id == claim["device_id"])
    )
    device = result.scalar_one_or_none()
    assert device is not None
    assert device.last_seen is not None


@pytest.mark.asyncio
async def test_device_token_on_multiple_endpoints(client: AsyncClient, auth_headers: dict):
    """Device token should work on various protected endpoints."""
    claim = await _pair_device(client, auth_headers)
    device_headers = {"Authorization": f"Bearer {claim['device_token']}"}

    # Health (no auth required, but should work)
    resp = await client.get("/api/health")
    assert resp.status_code == 200

    # Todos
    resp = await client.get("/api/todos", headers=device_headers)
    assert resp.status_code == 200

    # Events
    resp = await client.get("/api/events", headers=device_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_invalid_device_token_rejected(client: AsyncClient):
    """A made-up token should be rejected."""
    resp = await client.get("/api/todos", headers={"Authorization": "Bearer fake-token-123"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_websocket_ticket_preserves_device_identity(client: AsyncClient, auth_headers: dict):
    claim = await _pair_device(client, auth_headers)
    response = await client.post(
        "/api/auth/ws-ticket",
        headers={"Authorization": f"Bearer {claim['device_token']}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["expires_in"] == 60
    payload = decode_token_any(data["ticket"], allowed_types={"ws_ticket"})
    assert payload["sub"] == claim["device_id"]
    assert payload["principal_type"] == "device"


def test_device_websocket_ticket_completes_handshake():
    """A device ticket must authenticate the WebSocket, not impersonate its raw token."""
    # Do not enter TestClient's context manager here: the shared async fixture
    # already owns database setup, while the app lifespan initializes the
    # separate production engine. Requests and WebSockets still traverse the
    # full ASGI routing/dependency stack without lifespan startup.
    client = TestClient(app)
    try:
        login = client.post("/api/auth/login", json={"pin": "123456"})
        assert login.status_code == 200
        headers = {
            "Authorization": f"Bearer {login.json()['access_token']}"
        }

        pairing = client.post("/api/pairing/session", headers=headers)
        assert pairing.status_code == 200
        claim = client.post(
            "/api/pairing/claim",
            json={
                "code": pairing.json()["code"],
                "device_name": "WebSocket Android",
                "device_type": "android",
            },
        )
        assert claim.status_code == 200

        ticket = client.post(
            "/api/auth/ws-ticket",
            headers={
                "Authorization": f"Bearer {claim.json()['device_token']}"
            },
        )
        assert ticket.status_code == 200

        with client.websocket_connect(
            f"/ws?ticket={ticket.json()['ticket']}"
        ) as websocket:
            websocket.send_json({"type": "ping"})
            assert websocket.receive_json() == {"type": "pong"}
    finally:
        client.close()


@pytest.mark.asyncio
async def test_revoked_device_cannot_get_websocket_ticket(client: AsyncClient, auth_headers: dict):
    claim = await _pair_device(client, auth_headers)
    await client.delete(f"/api/pairing/devices/{claim['device_id']}", headers=auth_headers)

    response = await client.post(
        "/api/auth/ws-ticket",
        headers={"Authorization": f"Bearer {claim['device_token']}"},
    )

    assert response.status_code == 401
