import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.paired_device import PairedDevice


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
