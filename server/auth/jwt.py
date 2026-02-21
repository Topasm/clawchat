"""JWT token creation and verification using python-jose."""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from config import settings

ALGORITHM = "HS256"


def create_access_token(data: dict) -> str:
    """Create a JWT access token with expiry from settings.JWT_EXPIRY_HOURS."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRY_HOURS)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """Create a longer-lived refresh token (7 days)."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Verify and decode a JWT token.

    Returns the decoded payload dict.
    Raises ``jose.JWTError`` on invalid or expired tokens.
    """
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    return payload
