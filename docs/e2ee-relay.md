# E2EE mobile relay

ClawChat normally connects a mobile client directly to the desktop host over the
LAN. When `RELAY_URL` is configured, the host also opens an outbound WebSocket to
a small relay service. Mobile clients try the direct URL first and automatically
fall back to that relay when the LAN path is unavailable.

The relay is not trusted with application data. Pairing creates a persistent
X25519 host identity in the host SQLite database. Its public key and stable host
ID are included in the pairing QR code. Each relay client creates an ephemeral
X25519 key, derives a per-connection key with HKDF-SHA256, and encrypts HTTP
requests, responses, and live events with AES-256-GCM. The relay sees host IDs,
client IDs, timing, and encrypted frame sizes only.

## Run a relay

Build and run the standalone service:

```bash
docker build -t clawchat-relay ./relay
docker run --restart unless-stopped -p 8787:8787 clawchat-relay
```

For internet use, place it behind an HTTPS reverse proxy that supports WebSocket
upgrades. For example, proxy `https://relay.example.com` to
`http://127.0.0.1:8787`.

## Connect a desktop host

Set the relay URL in the server environment before starting the desktop host:

```bash
RELAY_URL=https://relay.example.com
```

The embedded server inherits this environment variable. It connects outbound;
no router port-forward or inbound firewall rule is required. Restart ClawChat,
then generate a new pairing QR code. The QR must contain `relay_url`, `host_id`,
and `host_public_key` for automatic fallback.

Existing QR and six-digit-code clients remain compatible on the LAN. Devices
must pair again to learn relay metadata if they were paired before relay support
was enabled.

## Operational notes

- Keep TLS enabled between devices and the relay even though payloads are E2EE;
  TLS also protects metadata from local observers.
- The host's cryptographic identity is stored in the same SQLite database as
  other ClawChat state. Restoring that database preserves paired trust.
- Revoking a device prevents new HTTP, direct WebSocket, and relay event
  subscriptions with its token.
- A relay operator can interrupt traffic or report a host as offline, but cannot
  decrypt or forge authenticated application frames.
- After reconnecting, clients refetch authoritative todos, events, today data,
  conversations, and the active chat to recover events missed while offline.
