from datetime import datetime, timezone

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.jwt import decode_token_any
from database import get_db
from exceptions import UnauthorizedError

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Authenticate via access token (PIN login) or device token (pairing).

    For device tokens, verifies the device is still active and updates last_seen.
    """
    if credentials is None:
        raise UnauthorizedError("Missing authorization header")
    payload = decode_token_any(credentials.credentials)
    token_type = payload.get("type")

    if token_type == "device":
        from models.paired_device import PairedDevice

        device_id = payload["sub"]
        result = await db.execute(
            select(PairedDevice).where(PairedDevice.id == device_id)
        )
        device = result.scalar_one_or_none()
        if not device or not device.is_active:
            raise UnauthorizedError("Device has been revoked")
        device.last_seen = datetime.now(timezone.utc)
        await db.commit()

    return payload["sub"]
