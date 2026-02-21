"""Push notification token registration."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth.dependencies import get_current_user

router = APIRouter(tags=["notifications"])

logger = logging.getLogger(__name__)

# Simple in-memory token store (single-user app)
_push_tokens: list[str] = []


class RegisterTokenRequest(BaseModel):
    token: str
    device_id: Optional[str] = None


@router.post("/register-token")
async def register_push_token(
    data: RegisterTokenRequest,
    current_user: dict = Depends(get_current_user),
):
    """Store an Expo push token for notifications."""
    if data.token not in _push_tokens:
        _push_tokens.append(data.token)
        logger.info("Registered push token: %s", data.token[:20] + "...")
    return {"status": "registered"}
