"""Push tokens must land on the column the sender actually reads.

``PushService.send_to_all_devices`` selects ``PairedDevice.push_token``.  The
registration endpoint used to append to a module-level list instead, so every
reminder push found zero devices no matter how many had registered.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.paired_device import PairedDevice


async def _pair_a_device(client: AsyncClient, auth_headers: dict) -> tuple[str, str]:
    """Run the real pairing flow and return (device_id, device_token)."""
    code = (await client.post("/api/pairing/session", headers=auth_headers)).json()["code"]
    claim = await client.post(
        "/api/pairing/claim",
        json={"code": code, "device_name": "Test Phone", "device_type": "android"},
    )
    assert claim.status_code == 200
    body = claim.json()
    return body["device_id"], body["device_token"]


async def _stored_token(db: AsyncSession, device_id: str) -> str | None:
    return (
        await db.execute(select(PairedDevice.push_token).where(PairedDevice.id == device_id))
    ).scalar_one_or_none()


@pytest.mark.asyncio
async def test_a_device_registers_its_own_token(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession
):
    device_id, device_token = await _pair_a_device(client, auth_headers)

    resp = await client.post(
        "/api/notifications/register-token",
        json={"token": "fcm-abc"},
        headers={"Authorization": f"Bearer {device_token}"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "registered", "device_id": device_id}
    assert await _stored_token(db_session, device_id) == "fcm-abc"


@pytest.mark.asyncio
async def test_the_registered_token_is_visible_to_the_sender(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession
):
    """The exact query PushService uses must return the token."""
    device_id, device_token = await _pair_a_device(client, auth_headers)
    await client.post(
        "/api/notifications/register-token",
        json={"token": "fcm-visible"},
        headers={"Authorization": f"Bearer {device_token}"},
    )

    rows = (
        await db_session.execute(
            select(PairedDevice.push_token).where(
                PairedDevice.push_token.is_not(None),
                PairedDevice.push_token != "",
            )
        )
    ).scalars().all()

    assert "fcm-visible" in rows


@pytest.mark.asyncio
async def test_a_pin_authenticated_caller_must_name_the_device(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession
):
    device_id, _ = await _pair_a_device(client, auth_headers)

    named = await client.post(
        "/api/notifications/register-token",
        json={"token": "fcm-named", "device_id": device_id},
        headers=auth_headers,
    )
    assert named.status_code == 200
    assert await _stored_token(db_session, device_id) == "fcm-named"


@pytest.mark.asyncio
async def test_a_token_with_no_device_is_reported_as_ignored(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession
):
    """Reporting success for an undeliverable token is how this broke before."""
    device_id, _ = await _pair_a_device(client, auth_headers)

    resp = await client.post(
        "/api/notifications/register-token",
        json={"token": "fcm-orphan"},
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "ignored"
    assert await _stored_token(db_session, device_id) is None


@pytest.mark.asyncio
async def test_an_unknown_device_is_rejected(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/notifications/register-token",
        json={"token": "fcm-nowhere", "device_id": "dev_missing"},
        headers=auth_headers,
    )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_registration_requires_authentication(client: AsyncClient):
    resp = await client.post(
        "/api/notifications/register-token", json={"token": "fcm-anon"}
    )

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_re_registering_the_same_token_is_idempotent(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession
):
    device_id, device_token = await _pair_a_device(client, auth_headers)
    headers = {"Authorization": f"Bearer {device_token}"}

    for _ in range(2):
        resp = await client.post(
            "/api/notifications/register-token", json={"token": "fcm-same"}, headers=headers
        )
        assert resp.status_code == 200

    rotated = await client.post(
        "/api/notifications/register-token", json={"token": "fcm-new"}, headers=headers
    )
    assert rotated.status_code == 200
    assert await _stored_token(db_session, device_id) == "fcm-new"
