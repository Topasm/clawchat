import base64
import json
import os
from collections import deque

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def decode_key(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def encode_bytes(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class RelayCipher:
    """Per-client E2EE channel. The relay only sees opaque encrypted frames."""

    def __init__(self, private_key: str, peer_public_key: str, host_id: str):
        own_key = X25519PrivateKey.from_private_bytes(decode_key(private_key))
        peer_key = X25519PublicKey.from_public_bytes(decode_key(peer_public_key))
        shared_secret = own_key.exchange(peer_key)
        key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=host_id.encode("utf-8"),
            info=b"clawchat-relay-v1",
        ).derive(shared_secret)
        self._cipher = AESGCM(key)
        self._seen_nonces: set[str] = set()
        self._nonce_order: deque[str] = deque(maxlen=2048)

    def encrypt(self, payload: dict) -> dict:
        nonce = os.urandom(12)
        plaintext = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        ciphertext = self._cipher.encrypt(nonce, plaintext, b"clawchat-relay-v1")
        return {
            "kind": "encrypted",
            "nonce": encode_bytes(nonce),
            "ciphertext": encode_bytes(ciphertext),
        }

    def decrypt(self, frame: dict) -> dict:
        if frame.get("kind") != "encrypted":
            raise ValueError("Expected an encrypted relay frame")
        nonce_value = frame["nonce"]
        if nonce_value in self._seen_nonces:
            raise ValueError("Relay frame nonce was replayed")
        nonce = decode_key(nonce_value)
        ciphertext = decode_key(frame["ciphertext"])
        plaintext = self._cipher.decrypt(nonce, ciphertext, b"clawchat-relay-v1")
        if len(self._nonce_order) == self._nonce_order.maxlen:
            self._seen_nonces.discard(self._nonce_order[0])
        self._nonce_order.append(nonce_value)
        self._seen_nonces.add(nonce_value)
        result = json.loads(plaintext)
        if not isinstance(result, dict):
            raise ValueError("Relay payload must be a JSON object")
        return result
