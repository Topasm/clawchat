import base64

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from services.relay.relay_crypto import RelayCipher, encode_bytes


def keypair() -> tuple[str, str]:
    private = X25519PrivateKey.generate()
    private_bytes = private.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    public_bytes = private.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return encode_bytes(private_bytes), encode_bytes(public_bytes)


def test_relay_cipher_round_trip():
    host_private, host_public = keypair()
    client_private, client_public = keypair()
    host = RelayCipher(host_private, client_public, "claw_test")
    client = RelayCipher(client_private, host_public, "claw_test")

    frame = client.encrypt({"type": "http_request", "id": "one"})

    assert host.decrypt(frame) == {"type": "http_request", "id": "one"}


def test_relay_cipher_rejects_replay():
    host_private, host_public = keypair()
    client_private, client_public = keypair()
    host = RelayCipher(host_private, client_public, "claw_test")
    client = RelayCipher(client_private, host_public, "claw_test")
    frame = client.encrypt({"type": "subscribe"})

    host.decrypt(frame)
    with pytest.raises(ValueError, match="replayed"):
        host.decrypt(frame)


def test_relay_cipher_rejects_tampering():
    host_private, host_public = keypair()
    client_private, client_public = keypair()
    host = RelayCipher(host_private, client_public, "claw_test")
    client = RelayCipher(client_private, host_public, "claw_test")
    frame = client.encrypt({"type": "subscribe"})
    ciphertext = bytearray(base64.urlsafe_b64decode(frame["ciphertext"] + "=="))
    ciphertext[-1] ^= 1
    frame["ciphertext"] = encode_bytes(bytes(ciphertext))

    with pytest.raises(Exception):
        host.decrypt(frame)
