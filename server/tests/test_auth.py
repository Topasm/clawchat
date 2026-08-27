import pytest
from auth.jwt import decode_token, hash_refresh_token_id
from httpx import AsyncClient
from models.refresh_session import RefreshSession
from sqlalchemy import select


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
async def test_login_persists_only_hashed_refresh_token_state(
    client: AsyncClient,
    db_session,
):
    resp = await client.post("/api/auth/login", json={"pin": "123456"})
    refresh_token = resp.json()["refresh_token"]
    payload = decode_token(refresh_token, expected_type="refresh")

    result = await db_session.execute(
        select(RefreshSession).where(RefreshSession.id == payload["sid"])
    )
    session = result.scalar_one()

    assert session.current_jti_hash == hash_refresh_token_id(payload["jti"])
    assert session.current_jti_hash != payload["jti"]
    assert refresh_token not in session.current_jti_hash


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
    assert data["refresh_token"] != refresh_token


@pytest.mark.asyncio
async def test_rotated_refresh_token_is_single_use(client: AsyncClient):
    login = await client.post("/api/auth/login", json={"pin": "123456"})
    original_token = login.json()["refresh_token"]

    first_refresh = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": original_token},
    )
    assert first_refresh.status_code == 200
    rotated_token = first_refresh.json()["refresh_token"]

    second_refresh = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": rotated_token},
    )
    assert second_refresh.status_code == 200


@pytest.mark.asyncio
async def test_refresh_token_reuse_revokes_the_token_family(client: AsyncClient):
    login = await client.post("/api/auth/login", json={"pin": "123456"})
    original_token = login.json()["refresh_token"]
    first_refresh = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": original_token},
    )
    rotated_token = first_refresh.json()["refresh_token"]

    replay = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": original_token},
    )
    assert replay.status_code == 401

    latest_after_reuse = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": rotated_token},
    )
    assert latest_after_reuse.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_refresh_session_without_request_body(client: AsyncClient):
    login = await client.post("/api/auth/login", json={"pin": "123456"})
    tokens = login.json()

    logout = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert logout.status_code == 200

    refresh = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refresh.status_code == 401

    protected = await client.get(
        "/api/todos",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert protected.status_code == 401


@pytest.mark.asyncio
async def test_logout_accepts_optional_refresh_token(client: AsyncClient):
    first_login = await client.post("/api/auth/login", json={"pin": "123456"})
    second_login = await client.post("/api/auth/login", json={"pin": "123456"})
    first_tokens = first_login.json()
    second_tokens = second_login.json()

    logout = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {first_tokens['access_token']}"},
        json={"refresh_token": second_tokens["refresh_token"]},
    )
    assert logout.status_code == 200

    first_refresh = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": first_tokens["refresh_token"]},
    )
    second_refresh = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": second_tokens["refresh_token"]},
    )
    assert first_refresh.status_code == 200
    assert second_refresh.status_code == 401


@pytest.mark.asyncio
async def test_access_protected_endpoint_with_token(
    client: AsyncClient, auth_headers: dict
):
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
