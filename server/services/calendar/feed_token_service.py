"""Issue, verify and revoke the credential behind a subscribable ICS URL.

A calendar client that subscribes to a feed re-fetches it on its own schedule
and cannot be taught to send an ``Authorization`` header, so the credential has
to live in the URL. Three properties keep that from becoming a second, weaker
way into the API:

* The token is an opaque ``secrets.token_urlsafe(32)`` string, not a JWT. It
  carries no claims and cannot be decoded, so ``decode_token_any`` -- and
  therefore ``get_current_principal`` and every endpoint behind it -- rejects it
  as malformed. The only code that can turn it back into a principal is
  :func:`resolve_feed_token`, which no other router calls.
* Only ``sha256`` of the token is stored, reusing the same helpers the refresh
  token family already uses. A stolen database yields no working URL.
* Verification compares digests with :func:`secrets.compare_digest`, for the
  same reason ``verify_pin`` does.

The plaintext token is returned exactly once, by :func:`issue_feed_token`. It is
never logged, never re-derivable, and never echoed back by a read endpoint.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.jwt import create_refresh_token_id, hash_refresh_token_id
from exceptions import UnauthorizedError
from models.calendar_feed_token import CalendarFeedToken

# The feed is read-only and scoped to one thing; the subject exists so the row
# lines up with the rest of the auth tables rather than to support multi-tenancy.
FEED_TOKEN_SUBJECT = "user"

# Reissue revokes the previous row with this reason so an audit of the table can
# tell a deliberate rotation from a user-initiated revoke.
REVOCATION_REASON_ROTATED = "rotated"
REVOCATION_REASON_REVOKED = "revoked"


async def get_active_feed_token(
    db: AsyncSession, subject: str = FEED_TOKEN_SUBJECT
) -> CalendarFeedToken | None:
    """Return the live feed row for *subject*, or ``None`` when none exists."""
    result = await db.execute(
        select(CalendarFeedToken)
        .where(
            CalendarFeedToken.subject == subject,
            CalendarFeedToken.revoked_at.is_(None),
        )
        .order_by(CalendarFeedToken.created_at.desc())
    )
    return result.scalars().first()


async def revoke_feed_tokens(
    db: AsyncSession,
    subject: str = FEED_TOKEN_SUBJECT,
    *,
    reason: str = REVOCATION_REASON_REVOKED,
) -> int:
    """Revoke every live feed row for *subject*; return how many were revoked.

    The caller commits. Revoking the whole set rather than a single row is what
    makes "reissuing invalidates the old URL" true even if an earlier failure
    left more than one row live.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(CalendarFeedToken).where(
            CalendarFeedToken.subject == subject,
            CalendarFeedToken.revoked_at.is_(None),
        )
    )
    rows = result.scalars().all()
    for row in rows:
        row.revoked_at = now
        row.revocation_reason = reason
    return len(rows)


async def issue_feed_token(
    db: AsyncSession, subject: str = FEED_TOKEN_SUBJECT
) -> tuple[str, CalendarFeedToken]:
    """Mint a new feed token, revoking any predecessor in the same transaction.

    Returns ``(plaintext_token, row)``. The plaintext is the only copy that will
    ever exist -- the row holds a hash -- so the caller must hand it straight to
    the response and drop it.
    """
    await revoke_feed_tokens(db, subject, reason=REVOCATION_REASON_ROTATED)
    token = create_refresh_token_id()
    row = CalendarFeedToken(
        subject=subject,
        token_hash=hash_refresh_token_id(token),
    )
    db.add(row)
    await db.flush()
    return token, row


async def resolve_feed_token(db: AsyncSession, token: str) -> CalendarFeedToken:
    """Verify a presented feed token and return its row.

    This is the *only* path that accepts a feed token, and it grants nothing
    beyond the row itself: no principal, no session, no bearer credential. It
    raises :class:`UnauthorizedError` for a malformed, unknown or revoked token,
    with the same message in every case so the response cannot distinguish
    "never existed" from "revoked".

    ``last_used_at`` is updated on success; the caller commits.
    """
    invalid = UnauthorizedError("Invalid calendar feed token")
    if not token or not _is_wellformed(token):
        raise invalid

    presented_hash = hash_refresh_token_id(token)
    result = await db.execute(
        select(CalendarFeedToken).where(CalendarFeedToken.revoked_at.is_(None))
    )
    candidates = result.scalars().all()

    matched: CalendarFeedToken | None = None
    for row in candidates:
        # Constant-time for the same reason verify_pin is: a timing-visible
        # comparison over a stored digest leaks it byte by byte.
        if secrets.compare_digest(presented_hash, row.token_hash):
            matched = row
    if matched is None:
        raise invalid

    matched.last_used_at = datetime.now(timezone.utc)
    return matched


def _is_wellformed(token: str) -> bool:
    """Cheap shape check so obviously-wrong input never reaches the database.

    ``secrets.token_urlsafe(32)`` is base64url over 32 bytes, so the alphabet is
    fixed and the length is bounded. Rejecting anything else keeps a huge or
    exotic path segment from being hashed and queried. It is a filter, not the
    authentication decision -- a well-formed token still has to match a row.
    """
    if not (16 <= len(token) <= 128):
        return False
    allowed = set(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    )
    return set(token) <= allowed
