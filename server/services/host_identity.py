import base64
import hashlib

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from sqlalchemy.ext.asyncio import AsyncSession

from models.host_identity import HostIdentity


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


async def get_or_create_host_identity(db: AsyncSession) -> HostIdentity:
    identity = await db.get(HostIdentity, "primary")
    if identity is not None:
        return identity

    private_key = X25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    identity = HostIdentity(
        id="primary",
        host_id=f"claw_{_encode(hashlib.sha256(public_bytes).digest()[:16])}",
        private_key=_encode(private_bytes),
        public_key=_encode(public_bytes),
    )
    db.add(identity)
    await db.flush()
    return identity
