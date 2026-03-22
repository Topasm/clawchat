import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_with_correct_pin(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={"pin": "123456"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] > 0


@pytest.mark.asyncio
async def test_login_with_wrong_pin(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={"pin": "000000"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    login = await client.post("/api/auth/login", json={"pin": "123456"})
    refresh_token = login.json()["refresh_token"]

    resp = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data


@pytest.mark.asyncio
async def test_access_protected_endpoint_with_token(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")
    assert "ai_provider" in data
    assert "version" in data


@pytest.mark.asyncio
async def test_protected_endpoint_without_token(client: AsyncClient):
    resp = await client.get("/api/todos", headers={})
    assert resp.status_code == 401 or resp.status_code == 403
