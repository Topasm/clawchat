import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_pairing_session(client: AsyncClient, auth_headers: dict):
    resp = await client.post("/api/pairing/session", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "code" in data
    assert len(data["code"]) == 6
    assert "expires_at" in data
    assert "qr_payload" in data


@pytest.mark.asyncio
async def test_create_pairing_session_requires_auth(client: AsyncClient):
    resp = await client.post("/api/pairing/session")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_claim_pairing_session(client: AsyncClient, auth_headers: dict):
    # Create session
    session_resp = await client.post("/api/pairing/session", headers=auth_headers)
    code = session_resp.json()["code"]

    # Claim it (no auth needed)
    claim_resp = await client.post("/api/pairing/claim", json={
        "code": code,
        "device_name": "Test Phone",
        "device_type": "android",
    })
    assert claim_resp.status_code == 200
    data = claim_resp.json()
    assert "device_id" in data
    assert "device_token" in data
    assert "api_base_url" in data
    assert "host_name" in data
    assert "server_version" in data


@pytest.mark.asyncio
async def test_claim_invalid_code(client: AsyncClient):
    resp = await client.post("/api/pairing/claim", json={
        "code": "999999",
        "device_name": "Test",
        "device_type": "android",
    })
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_claim_code_can_only_be_used_once(client: AsyncClient, auth_headers: dict):
    session_resp = await client.post("/api/pairing/session", headers=auth_headers)
    code = session_resp.json()["code"]

    # First claim succeeds
    resp1 = await client.post("/api/pairing/claim", json={
        "code": code,
        "device_name": "Phone 1",
        "device_type": "android",
    })
    assert resp1.status_code == 200

    # Second claim fails
    resp2 = await client.post("/api/pairing/claim", json={
        "code": code,
        "device_name": "Phone 2",
        "device_type": "ios",
    })
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_list_devices(client: AsyncClient, auth_headers: dict):
    # Create and claim a session
    session_resp = await client.post("/api/pairing/session", headers=auth_headers)
    code = session_resp.json()["code"]
    await client.post("/api/pairing/claim", json={
        "code": code,
        "device_name": "Test Phone",
        "device_type": "android",
    })

    # List devices
    resp = await client.get("/api/pairing/devices", headers=auth_headers)
    assert resp.status_code == 200
    devices = resp.json()["devices"]
    assert len(devices) == 1
    assert devices[0]["name"] == "Test Phone"
    assert devices[0]["device_type"] == "android"
    assert devices[0]["is_active"] is True


@pytest.mark.asyncio
async def test_revoke_device(client: AsyncClient, auth_headers: dict):
    # Create and claim
    session_resp = await client.post("/api/pairing/session", headers=auth_headers)
    code = session_resp.json()["code"]
    claim_resp = await client.post("/api/pairing/claim", json={
        "code": code,
        "device_name": "Test Phone",
        "device_type": "android",
    })
    device_id = claim_resp.json()["device_id"]

    # Revoke
    resp = await client.delete(f"/api/pairing/devices/{device_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "revoked"

    # Verify no longer in active list
    list_resp = await client.get("/api/pairing/devices", headers=auth_headers)
    assert len(list_resp.json()["devices"]) == 0
