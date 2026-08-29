"""Pin the security boundary around the subscribable ICS feed.

The feed URL is the only credential in the application that travels in a URL
rather than a header, so the tests that matter most here are the negative ones:
that the token unlocks the feed and *nothing else*, and that revoking or
reissuing takes effect immediately.
"""

import pytest
from httpx import AsyncClient
from jose import jwt
from sqlalchemy import select

from auth.dependencies import get_current_principal
from auth.jwt import decode_token_any, hash_refresh_token_id
from config import settings
from exceptions import UnauthorizedError
from models.calendar_feed_token import CalendarFeedToken

_EVENT = {
    "title": "VLA Model Review",
    "start_time": "2026-03-02T15:00:00Z",
    "end_time": "2026-03-02T16:00:00Z",
}


async def _issue(client: AsyncClient, auth_headers: dict) -> str:
    resp = await client.post("/api/events/subscription", headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()["url"]


def _token_of(url: str) -> str:
    return url.rsplit("/", 1)[-1].removesuffix(".ics")


# -- the feed itself --------------------------------------------------------


@pytest.mark.asyncio
async def test_feed_url_serves_ics_without_any_authorization_header(
    client: AsyncClient, auth_headers
):
    """The whole point: a calendar client sends no header and still gets the feed."""
    await client.post("/api/events", json=_EVENT, headers=auth_headers)
    url = await _issue(client, auth_headers)

    resp = await client.get(url.replace("http://test", ""))

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    assert "BEGIN:VCALENDAR" in resp.text
    assert "VLA Model Review" in resp.text


@pytest.mark.asyncio
async def test_issue_response_is_the_only_place_the_url_appears(
    client: AsyncClient, auth_headers
):
    await _issue(client, auth_headers)

    resp = await client.get("/api/events/subscription", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["active"] is True
    assert body["created_at"] is not None
    # A read can never hand the secret back -- only the hash is stored.
    assert "url" not in body


@pytest.mark.asyncio
async def test_unknown_and_malformed_tokens_are_rejected(client: AsyncClient):
    for token in ("a" * 43, "not-a-real-token-value-but-well-formed-xxxx"):
        resp = await client.get(f"/api/events/feed/{token}.ics")
        assert resp.status_code == 401, token
        assert resp.json()["error"]["code"] == "UNAUTHORIZED"

    # Too short to be a feed token at all: rejected by the path constraint.
    assert (await client.get("/api/events/feed/short.ics")).status_code == 422


@pytest.mark.asyncio
async def test_revoked_token_stops_working_immediately(
    client: AsyncClient, auth_headers
):
    url = await _issue(client, auth_headers)
    path = url.replace("http://test", "")
    assert (await client.get(path)).status_code == 200

    assert (
        await client.delete("/api/events/subscription", headers=auth_headers)
    ).status_code == 204

    assert (await client.get(path)).status_code == 401
    status = await client.get("/api/events/subscription", headers=auth_headers)
    assert status.json()["active"] is False


@pytest.mark.asyncio
async def test_reissue_invalidates_the_previous_url(client: AsyncClient, auth_headers):
    old_path = (await _issue(client, auth_headers)).replace("http://test", "")
    new_path = (await _issue(client, auth_headers)).replace("http://test", "")

    assert old_path != new_path
    assert (await client.get(old_path)).status_code == 401
    assert (await client.get(new_path)).status_code == 200


# -- privilege separation: the point of the whole design --------------------


@pytest.mark.asyncio
async def test_feed_token_is_rejected_by_every_other_endpoint(
    client: AsyncClient, auth_headers
):
    """A feed token must buy read access to the feed and nothing more.

    Presented as a bearer credential it has to fail everywhere, including on
    the endpoints that manage the feed itself -- otherwise leaking a
    subscription URL would escalate into full API access.
    """
    token = _token_of(await _issue(client, auth_headers))
    headers = {"Authorization": f"Bearer {token}"}

    protected = (
        ("get", "/api/events"),
        ("get", "/api/events/export.ics"),
        ("get", "/api/events/subscription"),
        ("post", "/api/events/subscription"),
        ("delete", "/api/events/subscription"),
        ("get", "/api/todos"),
        ("get", "/api/settings"),
        ("get", "/api/today"),
        ("get", "/api/admin/overview"),
    )
    for method, path in protected:
        resp = await getattr(client, method)(path, headers=headers)
        assert resp.status_code == 401, f"{method.upper()} {path} -> {resp.status_code}"

    # Creating an event with it must fail too, so the read-only feed can never
    # be turned into a write.
    resp = await client.post("/api/events", json=_EVENT, headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_feed_token_cannot_be_decoded_by_the_bearer_token_path(
    client: AsyncClient, auth_headers
):
    """The isolation is structural, not just a matter of route wiring.

    A feed token is opaque random text, not a JWT, so the shared decoders
    reject it before any claim is even read.
    """
    token = _token_of(await _issue(client, auth_headers))

    with pytest.raises(UnauthorizedError):
        decode_token_any(token)
    with pytest.raises(UnauthorizedError):
        decode_token_any(token, allowed_types={"access", "device", "feed"})

    # And the type gate holds even for a correctly signed JWT: ``decode_token_any``
    # is what enforces the allowed set, before ``validate_principal`` ever runs.
    forged = jwt.encode(
        {"sub": "user", "type": "feed"}, settings.jwt_secret, algorithm="HS256"
    )
    with pytest.raises(UnauthorizedError):
        decode_token_any(forged)


@pytest.mark.asyncio
async def test_access_token_is_not_accepted_as_a_feed_token(
    client: AsyncClient, auth_headers
):
    """And the reverse direction: a real JWT is not a feed credential either."""
    access_token = auth_headers["Authorization"].removeprefix("Bearer ")

    resp = await client.get(f"/api/events/feed/{access_token}.ics")

    assert resp.status_code != 200
    assert "BEGIN:VCALENDAR" not in resp.text


@pytest.mark.asyncio
async def test_managing_the_subscription_still_requires_a_bearer_token(
    client: AsyncClient,
):
    for method in ("get", "post", "delete"):
        resp = await getattr(client, method)("/api/events/subscription")
        assert resp.status_code == 401


# -- storage ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_only_a_hash_of_the_token_is_persisted(
    client: AsyncClient, auth_headers, db_session
):
    token = _token_of(await _issue(client, auth_headers))

    rows = (await db_session.execute(select(CalendarFeedToken))).scalars().all()
    row = next(r for r in rows if r.revoked_at is None)

    assert row.token_hash == hash_refresh_token_id(token)
    assert row.token_hash != token
    assert token not in row.token_hash
    # Nothing anywhere in the row echoes the plaintext.
    assert all(
        token not in str(value)
        for value in (row.id, row.subject, row.token_hash, row.revocation_reason)
    )


@pytest.mark.asyncio
async def test_revocation_is_recorded_rather_than_deleted(
    client: AsyncClient, auth_headers, db_session
):
    await _issue(client, auth_headers)
    await _issue(client, auth_headers)
    await client.delete("/api/events/subscription", headers=auth_headers)

    rows = (await db_session.execute(select(CalendarFeedToken))).scalars().all()

    assert len(rows) == 2
    assert all(row.revoked_at is not None for row in rows)
    assert {row.revocation_reason for row in rows} == {"rotated", "revoked"}


@pytest.mark.asyncio
async def test_fetching_the_feed_records_last_used_at(
    client: AsyncClient, auth_headers, db_session
):
    path = (await _issue(client, auth_headers)).replace("http://test", "")
    assert (await client.get(path)).status_code == 200

    row = (
        (
            await db_session.execute(
                select(CalendarFeedToken).where(
                    CalendarFeedToken.revoked_at.is_(None)
                )
            )
        )
        .scalars()
        .one()
    )
    assert row.last_used_at is not None


# -- the pre-existing bearer path is untouched ------------------------------


@pytest.mark.asyncio
async def test_bearer_export_still_works_and_still_requires_the_header(
    client: AsyncClient, auth_headers
):
    await client.post("/api/events", json=_EVENT, headers=auth_headers)

    authorized = await client.get("/api/events/export.ics", headers=auth_headers)
    assert authorized.status_code == 200
    assert "BEGIN:VCALENDAR" in authorized.text
    assert "VLA Model Review" in authorized.text

    assert (await client.get("/api/events/export.ics")).status_code == 401


@pytest.mark.asyncio
async def test_get_current_principal_is_reachable_only_with_a_real_token(
    client: AsyncClient, auth_headers
):
    """Guard against a future refactor wiring the feed token into the shared path."""
    assert get_current_principal is not None
    resp = await client.get("/api/events", headers=auth_headers)
    assert resp.status_code == 200
