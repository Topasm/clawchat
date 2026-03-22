from datetime import datetime

from pydantic import BaseModel


# --- Pairing Session ---
class PairingSessionCreate(BaseModel):
    """Desktop creates a pairing session."""
    pass  # no input needed, server generates code


class PairingSessionResponse(BaseModel):
    code: str
    expires_at: datetime
    qr_payload: str  # JSON string with host info + code for QR encoding


class PairingClaimRequest(BaseModel):
    """Mobile claims a pairing session with the code."""
    code: str
    device_name: str
    device_type: str  # "ios" | "android"


class PairingClaimResponse(BaseModel):
    device_id: str
    device_token: str  # JWT token for this device
    api_base_url: str
    host_name: str
    server_version: str


# --- Device Management ---
class PairedDeviceResponse(BaseModel):
    id: str
    name: str
    device_type: str
    paired_at: datetime
    last_seen: datetime
    is_active: bool

    model_config = {"from_attributes": True}


class DeviceListResponse(BaseModel):
    devices: list[PairedDeviceResponse]
