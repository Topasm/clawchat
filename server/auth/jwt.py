import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from config import settings
from exceptions import UnauthorizedError
from jose import JWTError, jwt

ALGORITHM = "HS256"


REFRESH_TOKEN_LIFETIME = timedelta(days=30)


def create_access_token(
    subject: str = "user",
    session_id: str | None = None,
) -> tuple[str, int]:
    expires_delta = timedelta(hours=settings.jwt_expiry_hours)
    expires_in = int(expires_delta.total_seconds())
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject, "exp": expire, "type": "access"}
    if session_id is not None:
        payload["sid"] = session_id
    token = jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)
    return token, expires_in


def create_refresh_token(
    subject: str = "user",
    session_id: str | None = None,
    token_id: str | None = None,
) -> str:
    """Create a refresh JWT with identifiers suitable for server-side rotation."""
    expire = datetime.now(timezone.utc) + REFRESH_TOKEN_LIFETIME
    payload = {
        "sub": subject,
        "exp": expire,
        "type": "refresh",
        "sid": session_id or str(uuid.uuid4()),
        "jti": token_id or create_refresh_token_id(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def create_refresh_token_id() -> str:
    """Return a high-entropy, URL-safe ID that is never stored in plaintext."""
    return secrets.token_urlsafe(32)


def hash_refresh_token_id(token_id: str) -> str:
    return hashlib.sha256(token_id.encode("utf-8")).hexdigest()


def hash_device_token(token: str) -> str:
    """Return the non-reversible database representation of a device token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_websocket_ticket(
    subject: str,
    principal_type: str,
    lifetime_seconds: int = 60,
) -> tuple[str, int]:
    """Create a short-lived credential safe to place in a WebSocket URL."""
    expire = datetime.now(timezone.utc) + timedelta(seconds=lifetime_seconds)
    payload = {
        "sub": subject,
        "exp": expire,
        "type": "ws_ticket",
        "principal_type": principal_type,
    }
    return jwt.encode(
        payload, settings.jwt_secret, algorithm=ALGORITHM
    ), lifetime_seconds


def decode_token(token: str, expected_type: str = "access") -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError:
        raise UnauthorizedError("Invalid or expired token")
    if payload.get("type") != expected_type:
        raise UnauthorizedError(f"Expected {expected_type} token")
    return payload


def decode_token_any(token: str, allowed_types: set[str] | None = None) -> dict:
    """Decode a token accepting multiple types (access, device)."""
    if allowed_types is None:
        allowed_types = {"access", "device"}
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"verify_exp": True, "require": []},
        )
    except JWTError:
        raise UnauthorizedError("Invalid or expired token")
    if payload.get("type") not in allowed_types:
        raise UnauthorizedError(f"Expected one of {allowed_types} token types")
    return payload


def verify_pin(pin: str) -> bool:
    """Compare in constant time so the PIN cannot be recovered digit by digit."""
    return secrets.compare_digest(pin, settings.pin)
