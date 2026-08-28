"""In-memory throttling for unauthenticated credential endpoints.

ClawChat is a single-process, self-hosted server, so per-process state is the
right scope here: there is no second worker to share counters with. The limiter
counts *failures* only, so a legitimate user who authenticates successfully is
never penalised, and it keys on the caller's address so one attacker cannot lock
out the household.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from fastapi import Request

from config import settings
from exceptions import TooManyRequestsError

# Cap the number of tracked keys so a rotating-source attacker cannot grow this
# map without bound. Eviction drops the entries closest to expiry first.
MAX_TRACKED_KEYS = 4096


@dataclass
class _Bucket:
    failures: list[float] = field(default_factory=list)
    locked_until: float = 0.0
    consecutive_lockouts: int = 0

    def expires_at(self, window: float) -> float:
        latest_failure = self.failures[-1] + window if self.failures else 0.0
        return max(self.locked_until, latest_failure)


class RateLimiter:
    """Sliding-window failure counter with exponential lockout backoff."""

    def __init__(
        self,
        *,
        name: str,
        max_failures: int,
        window_seconds: float,
        lockout_seconds: float,
        max_lockout_seconds: float = 3600.0,
    ) -> None:
        self.name = name
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.lockout_seconds = lockout_seconds
        self.max_lockout_seconds = max_lockout_seconds
        self._buckets: dict[str, _Bucket] = {}
        self._lock = asyncio.Lock()

    # -- internals ---------------------------------------------------------

    def _prune(self, now: float) -> None:
        stale = [
            key
            for key, bucket in self._buckets.items()
            if bucket.expires_at(self.window_seconds) <= now
        ]
        for key in stale:
            del self._buckets[key]

        if len(self._buckets) <= MAX_TRACKED_KEYS:
            return
        # Still over budget: evict whatever expires soonest.
        overflow = len(self._buckets) - MAX_TRACKED_KEYS
        by_expiry = sorted(
            self._buckets.items(),
            key=lambda item: item[1].expires_at(self.window_seconds),
        )
        for key, _ in by_expiry[:overflow]:
            del self._buckets[key]

    def _trim_window(self, bucket: _Bucket, now: float) -> None:
        cutoff = now - self.window_seconds
        bucket.failures = [ts for ts in bucket.failures if ts > cutoff]

    # -- public API --------------------------------------------------------

    async def check(self, key: str) -> None:
        """Raise :class:`TooManyRequestsError` when *key* is locked out."""
        if not settings.rate_limit_enabled:
            return
        now = time.monotonic()
        async with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                return
            if bucket.locked_until > now:
                raise TooManyRequestsError(retry_after=int(bucket.locked_until - now) + 1)

    async def record_failure(self, key: str) -> None:
        """Count one failed attempt, locking the key out once over budget."""
        if not settings.rate_limit_enabled:
            return
        now = time.monotonic()
        async with self._lock:
            self._prune(now)
            bucket = self._buckets.setdefault(key, _Bucket())
            self._trim_window(bucket, now)
            bucket.failures.append(now)

            if len(bucket.failures) < self.max_failures:
                return

            bucket.consecutive_lockouts += 1
            backoff = self.lockout_seconds * (2 ** (bucket.consecutive_lockouts - 1))
            bucket.locked_until = now + min(backoff, self.max_lockout_seconds)
            bucket.failures.clear()

    async def reset(self, key: str) -> None:
        """Clear all state for *key* after a successful authentication."""
        async with self._lock:
            self._buckets.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._buckets.clear()


def client_key(request: Request, *, scope: str = "") -> str:
    """Derive a throttling key from the caller's address.

    ``X-Forwarded-For`` is only honoured when ``TRUST_PROXY_HEADERS`` is set,
    because an untrusted client can otherwise spoof the header and sidestep the
    limiter entirely.
    """
    host = "unknown"
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            host = forwarded.split(",")[0].strip()
    if host == "unknown" and request.client is not None:
        host = request.client.host
    return f"{scope}:{host}" if scope else host


login_limiter = RateLimiter(
    name="login",
    max_failures=settings.login_max_failures,
    window_seconds=settings.login_failure_window_seconds,
    lockout_seconds=settings.login_lockout_seconds,
)

pairing_claim_limiter = RateLimiter(
    name="pairing_claim",
    max_failures=settings.pairing_max_failures,
    window_seconds=settings.pairing_failure_window_seconds,
    lockout_seconds=settings.pairing_lockout_seconds,
)
