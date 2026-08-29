import logging

from auth.dependencies import AuthPrincipal, get_current_principal
from database import get_db
from exceptions import NotFoundError
from fastapi import APIRouter, Depends
from models.paired_device import PairedDevice
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["notifications"])

logger = logging.getLogger(__name__)


class RegisterTokenRequest(BaseModel):
    token: str
    device_id: str | None = None


@router.post("/register-token")
async def register_push_token(
    data: RegisterTokenRequest,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    """Store a device's push token on its ``paired_devices`` row.

    ``PushService.send_to_all_devices`` reads tokens from that column, so a
    token that is not written there can never be delivered to.  A device token
    identifies its own row; a PIN-authenticated caller must name the device.
    """
    device_id = principal.subject if principal.token_type == "device" else data.device_id
    if not device_id:
        # Nothing to attach the token to, so it would be unreachable. Say so
        # rather than reporting success.
        logger.warning("Push token registration without a device to attach it to")
        return {"status": "ignored", "reason": "no_device"}

    device = (
        await db.execute(select(PairedDevice).where(PairedDevice.id == device_id))
    ).scalar_one_or_none()
    if device is None:
        raise NotFoundError(f"Device {device_id} not found")

    if device.push_token != data.token:
        device.push_token = data.token
        await db.commit()
        logger.info("Registered push token for device %s", device_id)

    return {"status": "registered", "device_id": device_id}
