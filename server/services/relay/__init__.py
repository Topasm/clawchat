"""Remote-access relay: host identity, transport and its crypto.

``host_identity`` derives the durable X25519 keypair a host is known by,
``relay_crypto`` is the sealed-box cipher, and ``relay_connector`` is the
outbound WebSocket connection to the relay.
"""
