# Remote Access Runbook

This runbook covers two methods for exposing ClawChat remotely. **Cloudflare Tunnel** is the recommended primary path; **Tailscale Serve** is a secondary option for tailnet-only access.

Both methods share the same architecture: only the reverse proxy (Caddy on `127.0.0.1:8080`) is exposed. The FastAPI server (`:8000`) and any upstream AI gateway remain loopback-only.

## Architecture

```
Internet / tailnet
        │
        ▼
  cloudflared / Tailscale Serve
        │
        ▼
  Caddy  127.0.0.1:8080        ← reverse proxy (serves dist/ + proxies /api, /ws)
        │
        ▼
  clawchat_server  127.0.0.1:8000
        │
        ▼
  OpenClaw  127.0.0.1:18789    ← optional AI gateway
```

## Service labels

- OpenClaw: `ai.openclaw.gateway`
- ClawChat server: `local.clawchat.server`
- Caddy: `homebrew.mxcl.caddy`
- Cloudflare Tunnel: `local.cloudflared.tunnel`
- Tailscale userspace daemon: `local.tailscaled.userspace`

## Useful commands

```bash
launchctl list | rg 'openclaw|clawchat|tailscale|caddy|cloudflared'
brew services list | rg 'caddy'
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8080/
```

## Restart commands

```bash
openclaw gateway restart
launchctl kickstart -k gui/$(id -u)/local.clawchat.server
brew services restart caddy
# Cloudflare Tunnel
launchctl kickstart -k gui/$(id -u)/local.cloudflared.tunnel
# Tailscale (if used)
launchctl kickstart -k gui/$(id -u)/local.tailscaled.userspace
```

---

## Option A: Cloudflare Tunnel (recommended)

Cloudflare Tunnel creates an outbound-only connection from your machine to Cloudflare's edge, so no inbound ports need to be opened. The tunnel terminates TLS at the edge and forwards traffic to the local reverse proxy.

### Prerequisites

- A Cloudflare account with a domain (or subdomain) you control.
- `cloudflared` installed: `brew install cloudflared` (macOS) or see [docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

### 1. Authenticate

```bash
cloudflared tunnel login
```

This opens a browser to authorise `cloudflared` with your Cloudflare account.

### 2. Create the tunnel

```bash
cloudflared tunnel create clawchat
```

Note the tunnel UUID printed (e.g. `a1b2c3d4-...`). A credentials file is saved to `~/.cloudflared/<UUID>.json`.

### 3. Configure DNS

```bash
cloudflared tunnel route dns clawchat clawchat.example.com
```

Replace `clawchat.example.com` with your chosen subdomain.

### 4. Create the config file

Save as `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /Users/<you>/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: clawchat.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

The service points at the Caddy reverse proxy, not the FastAPI server directly. This ensures `/`, `/api/*`, and `/ws` all share the same origin.

### 5. Run the tunnel

```bash
# Foreground (for testing)
cloudflared tunnel run clawchat

# As a launchd service (macOS, persistent)
cloudflared service install
# This creates ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
```

### 6. Verify

```bash
cloudflared tunnel info clawchat
curl https://clawchat.example.com/api/health
```

### 7. Configure the app

Set these environment variables so the frontend and backend know the public URL:

```bash
# .env
PUBLIC_URL=https://clawchat.example.com
VITE_DEFAULT_SERVER_URL=https://clawchat.example.com
```

Rebuild the frontend (`npm run build`) for `VITE_DEFAULT_SERVER_URL` to take effect.

### Status & troubleshooting

```bash
# Check tunnel status
cloudflared tunnel info clawchat

# View real-time logs
cloudflared tunnel run --loglevel debug clawchat

# Restart the launchd service
launchctl kickstart -k gui/$(id -u)/local.cloudflared.tunnel
```

### Mobile checklist (Cloudflare Tunnel)

1. Open `https://clawchat.example.com/` in the mobile browser.
2. The `Server URL` field should be prefilled with the same origin automatically.
3. Enter the ClawChat PIN and confirm the health indicator shows the server is reachable.
4. If login fails, verify `curl http://127.0.0.1:8080/api/health` works on the host and the tunnel is running (`cloudflared tunnel info clawchat`).

---

## Option B: Tailscale Serve (secondary)

For tailnet-only access without exposing anything to the public internet.

### Setup

Start the userspace daemon:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tailscaled.userspace.plist
launchctl kickstart -k gui/$(id -u)/local.tailscaled.userspace
```

Log in once:

```bash
tailscale up
```

If Tailscale says `Serve is not enabled on your tailnet`, approve it once in the admin UI and rerun the serve command.

After Tailscale login, expose the site to your tailnet only:

```bash
tailscale serve --bg http://127.0.0.1:8080
tailscale serve status
```

This exposes the Caddy site to your tailnet only. OpenClaw remains loopback-only.

### Mobile checklist (Tailscale)

1. Install Tailscale on the phone or tablet.
2. Sign in to the same tailnet as the machine running ClawChat.
3. Open `https://<machine>.<tailnet>.ts.net/` in the mobile browser.
4. Keep the prefilled `Server URL` unless you intentionally override it.
5. Enter the ClawChat PIN and verify the login page reports `Server reachable`.
6. If the `.ts.net` hostname does not resolve on mobile, confirm the device is actually connected to the same tailnet and MagicDNS is enabled.

---

## Credentials

- `PIN`, `JWT_SECRET`, and OpenClaw gateway token live in `server/.env`
- If the Telegram bot token was exposed, rotate it in `@BotFather`
