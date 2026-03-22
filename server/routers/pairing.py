import json
import random
import socket
import string
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from config import settings
from database import get_db
from models.paired_device import PairedDevice, PairingSession
from schemas.pairing import (
    PairingSessionResponse,
    PairingClaimRequest,
    PairingClaimResponse,
    PairedDeviceResponse,
    DeviceListResponse,
)

router = APIRouter()

PAIRING_EXPIRY_MINUTES = 5


def _get_local_ip() -> str:
    """Get the machine's LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _get_base_url(request: Request | None = None) -> str:
    """Build the base URL for pairing, preferring public_url, then LAN IP."""
    if settings.public_url:
        return settings.public_url
    host = settings.host
    if host == "0.0.0.0":
        host = _get_local_ip()
    return f"http://{host}:{settings.port}"


def _generate_code() -> str:
    """Generate a 6-digit numeric pairing code."""
    return "".join(random.choices(string.digits, k=6))


def _create_device_token(device_id: str) -> str:
    """Create a long-lived JWT for a paired device."""
    payload = {
        "sub": device_id,
        "type": "device",
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@router.post("/session", response_model=PairingSessionResponse)
async def create_pairing_session(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Create a new pairing session (desktop-initiated)."""
    # Clean up expired sessions
    now = datetime.now(timezone.utc)
    expired = await db.execute(
        select(PairingSession).where(PairingSession.expires_at < now)
    )
    for session in expired.scalars():
        await db.delete(session)

    code = _generate_code()
    expires_at = now + timedelta(minutes=PAIRING_EXPIRY_MINUTES)

    base_url = _get_base_url()
    qr_payload = json.dumps({
        "type": "clawchat_pair",
        "code": code,
        "server_url": base_url,
        "version": "0.1.0",
    })

    session = PairingSession(
        code=code,
        expires_at=expires_at,
    )
    db.add(session)
    await db.commit()

    return PairingSessionResponse(
        code=code,
        expires_at=expires_at,
        qr_payload=qr_payload,
    )


@router.post("/claim", response_model=PairingClaimResponse)
async def claim_pairing_session(
    req: PairingClaimRequest,
    db: AsyncSession = Depends(get_db),
):
    """Mobile claims a pairing session using the code. No auth required -- the code IS the auth."""
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(PairingSession).where(
            PairingSession.code == req.code,
            PairingSession.is_used == False,  # noqa: E712
            PairingSession.expires_at > now,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Invalid or expired pairing code")

    # Create paired device
    device_id = str(uuid.uuid4())
    device_token = _create_device_token(device_id)

    device = PairedDevice(
        id=device_id,
        name=req.device_name,
        device_type=req.device_type,
        device_token=device_token,
    )
    db.add(device)

    # Mark session as used
    session.is_used = True
    session.claimed_by_device_id = device_id

    await db.commit()

    api_base_url = _get_base_url()

    return PairingClaimResponse(
        device_id=device_id,
        device_token=device_token,
        api_base_url=api_base_url,
        host_name="ClawChat Host",
        server_version="0.1.0",
    )


@router.get("/devices", response_model=DeviceListResponse)
async def list_devices(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """List all paired devices (desktop management)."""
    result = await db.execute(
        select(PairedDevice).where(PairedDevice.is_active == True).order_by(  # noqa: E712
            PairedDevice.paired_at.desc()
        )
    )
    devices = result.scalars().all()
    return DeviceListResponse(
        devices=[
            PairedDeviceResponse(
                id=d.id,
                name=d.name,
                device_type=d.device_type,
                paired_at=d.paired_at,
                last_seen=d.last_seen,
                is_active=d.is_active,
            )
            for d in devices
        ]
    )


@router.delete("/devices/{device_id}")
async def revoke_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Revoke a paired device (desktop management)."""
    result = await db.execute(
        select(PairedDevice).where(PairedDevice.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    device.is_active = False
    await db.commit()
    return {"status": "revoked", "device_id": device_id}
