"""Brute-force protection for the unauthenticated credential endpoints."""

import pytest
from httpx import AsyncClient

from config import settings
from services.rate_limiter import (
    RateLimiter,
    login_limiter,
    pairing_claim_limiter,
)


@pytest.fixture(autouse=True)
async def _clean_limiters():
    await login_limiter.clear()
    await pairing_claim_limiter.clear()
    yield
    await login_limiter.clear()
    await pairing_claim_limiter.clear()


# --- login ---------------------------------------------------------------


async def test_login_locks_out_after_repeated_wrong_pins(client: AsyncClient):
    for _ in range(settings.login_max_failures):
        resp = await client.post("/api/auth/login", json={"pin": "000000"})
        assert resp.status_code == 401

    resp = await client.post("/api/auth/login", json={"pin": "000000"})
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "TOO_MANY_REQUESTS"
    assert int(resp.headers["Retry-After"]) > 0


async def test_lockout_also_rejects_the_correct_pin(client: AsyncClient):
    """The whole point: a guesser must not keep going once locked out."""
    for _ in range(settings.login_max_failures):
        await client.post("/api/auth/login", json={"pin": "000000"})

    resp = await client.post("/api/auth/login", json={"pin": "123456"})
    assert resp.status_code == 429


async def test_successful_login_clears_the_failure_counter(client: AsyncClient):
    for _ in range(settings.login_max_failures - 1):
        assert (
            await client.post("/api/auth/login", json={"pin": "000000"})
        ).status_code == 401

    assert (
        await client.post("/api/auth/login", json={"pin": "123456"})
    ).status_code == 200

    # Counter was reset, so the budget starts over instead of locking out.
    for _ in range(settings.login_max_failures - 1):
        assert (
            await client.post("/api/auth/login", json={"pin": "000000"})
        ).status_code == 401


# --- pairing claim -------------------------------------------------------


async def test_pairing_claim_locks_out_after_repeated_wrong_codes(
    client: AsyncClient,
):
    payload = {"code": "000000", "device_name": "phone", "device_type": "android"}
    for _ in range(settings.pairing_max_failures):
        assert (await client.post("/api/pairing/claim", json=payload)).status_code == 404

    resp = await client.post("/api/pairing/claim", json=payload)
    assert resp.status_code == 429


# --- limiter unit behaviour ---------------------------------------------


async def test_lockout_backoff_grows_on_repeated_lockouts():
    limiter = RateLimiter(
        name="t",
        max_failures=2,
        window_seconds=60,
        lockout_seconds=10,
        max_lockout_seconds=100,
    )

    async def retry_after() -> int:
        try:
            await limiter.check("k")
        except Exception as exc:  # TooManyRequestsError
            return exc.details["retry_after"]
        return 0

    for _ in range(2):
        await limiter.record_failure("k")
    first = await retry_after()

    for _ in range(2):
        await limiter.record_failure("k")
    second = await retry_after()

    assert second > first


async def test_lockout_backoff_is_capped():
    limiter = RateLimiter(
        name="t",
        max_failures=1,
        window_seconds=60,
        lockout_seconds=10,
        max_lockout_seconds=30,
    )
    for _ in range(10):
        await limiter.record_failure("k")

    with pytest.raises(Exception) as excinfo:
        await limiter.check("k")
    assert excinfo.value.details["retry_after"] <= 31


async def test_limiter_keys_are_independent():
    limiter = RateLimiter(
        name="t", max_failures=1, window_seconds=60, lockout_seconds=10
    )
    await limiter.record_failure("a")

    await limiter.check("b")  # must not raise
    with pytest.raises(Exception):
        await limiter.check("a")


async def test_tracked_keys_stay_bounded():
    """A source-rotating attacker must not be able to grow the map without bound."""
    from services import rate_limiter as rl

    limiter = RateLimiter(
        name="t", max_failures=1, window_seconds=60, lockout_seconds=1
    )
    for i in range(rl.MAX_TRACKED_KEYS + 500):
        await limiter.record_failure(f"key-{i}")

    assert len(limiter._buckets) <= rl.MAX_TRACKED_KEYS
