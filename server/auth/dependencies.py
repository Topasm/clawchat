from dataclasses import dataclass
from datetime import datetime, timezone
import secrets

from auth.jwt import hash_device_token
from database import get_db
from exceptions import UnauthorizedError
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.jwt import decode_token_any

_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthPrincipal:
    subject: str
    token_type: str
    session_id: str | None = None


async def validate_principal(
    payload: dict,
    db: AsyncSession,
    presented_token: str | None = None,
) -> AuthPrincipal:
    """Validate token claims that require server-side state."""
    token_type = payload.get("type")
    subject = payload["sub"]
    session_id = payload.get("sid")
    if session_id is not None and not isinstance(session_id, str):
        raise UnauthorizedError("Invalid session identifier")

    if token_type == "device":
        from models.paired_device import PairedDevice

        result = await db.execute(
            select(PairedDevice).where(PairedDevice.id == subject)
        )
        device = result.scalar_one_or_none()
        if not device or not device.is_active:
            raise UnauthorizedError("Device has been revoked")
        if presented_token is not None and not secrets.compare_digest(
            device.device_token,
            hash_device_token(presented_token),
        ):
            raise UnauthorizedError("Device token has been replaced")
        device.last_seen = datetime.now(timezone.utc)
        await db.commit()

    elif token_type == "access" and session_id is not None:
        from models.refresh_session import RefreshSession

        result = await db.execute(
            select(RefreshSession).where(
                RefreshSession.id == session_id,
                RefreshSession.subject == subject,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > datetime.now(timezone.utc),
            )
        )
        if result.scalar_one_or_none() is None:
            raise UnauthorizedError("Session has been revoked or expired")

    return AuthPrincipal(
        subject=subject,
        token_type=token_type,
        session_id=session_id,
    )


async def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthPrincipal:
    """Authenticate via access token (PIN login) or device token (pairing).

    For device tokens, verifies the device is still active and updates last_seen.
    """
    if credentials is None:
        raise UnauthorizedError("Missing authorization header")
    payload = decode_token_any(credentials.credentials)
    return await validate_principal(payload, db, credentials.credentials)


async def get_current_user(
    principal: AuthPrincipal = Depends(get_current_principal),
) -> str:
    return principal.subject
