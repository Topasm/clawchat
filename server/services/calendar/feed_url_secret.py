"""A secret calendar address is a password: encrypted at rest, never shown whole.

Anyone holding a Google "secret address in iCal format" can read that
calendar, so the database keeps it encrypted with a key that lives in its own
file, and screens and logs only ever see the host.
"""

import base64
import hashlib
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from config import _load_or_create_secret, settings
from cryptography.fernet import Fernet, InvalidToken

_cipher: Fernet | None = None
_cipher_path: str | None = None


def _key_path() -> str:
    if settings.calendar_key_file:
        return settings.calendar_key_file
    return str(Path(settings.upload_dir).expanduser().parent / "calendar.key")


def _fernet() -> Fernet:
    global _cipher, _cipher_path
    path = _key_path()
    if _cipher is None or _cipher_path != path:
        secret = _load_or_create_secret(path)
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
        _cipher, _cipher_path = Fernet(key), path
    return _cipher


def seal(url: str) -> str:
    return _fernet().encrypt(url.encode("utf-8")).decode("ascii")


def reveal(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("The calendar address can no longer be read; add it again") from exc


def normalize(url: str) -> str:
    """``webcal://`` is how calendar apps spell https; anything else is refused."""
    cleaned = url.strip()
    parts = urlsplit(cleaned)
    scheme = parts.scheme.lower()
    if scheme == "webcal":
        scheme = "https"
    if scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("Paste the calendar's address in iCal format (https://…/basic.ics)")
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, ""))


def mask(url: str) -> str:
    """What screens show: the host, and nothing that would open the calendar."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.hostname}/…"
