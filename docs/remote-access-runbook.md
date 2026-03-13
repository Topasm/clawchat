# Same-Mac Remote Access Runbook

This setup keeps all services on the same Mac:

- `OpenClaw` on `127.0.0.1:18789`
- `clawchat_server` on `127.0.0.1:8000`
- `Caddy` on `127.0.0.1:8080`

`Caddy` serves the built `clawchat` app and proxies `/api` + `/ws` to `clawchat_server`.
Only the reverse proxy should be exposed remotely.

ClawChat does not depend on Telegram for this flow. Telegram is only used if OpenClaw is also configured as a separate bot channel.

## Service labels

- OpenClaw: `ai.openclaw.gateway`
- ClawChat server: `local.clawchat.server`
- Tailscale userspace daemon: `local.tailscaled.userspace`
- Caddy: `homebrew.mxcl.caddy`

## Useful commands

```bash
launchctl list | rg 'openclaw|clawchat|tailscale|caddy'
brew services list | rg 'caddy'
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8080/
/Users/ahrilab/.clawchat-remote/tailscale-local.sh status
```

## Restart commands

```bash
openclaw gateway restart
launchctl kickstart -k gui/$(id -u)/local.clawchat.server
launchctl kickstart -k gui/$(id -u)/local.tailscaled.userspace
brew services restart caddy
```

## Tailscale remote serving

Start the userspace daemon:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tailscaled.userspace.plist
launchctl kickstart -k gui/$(id -u)/local.tailscaled.userspace
```

Log in once:

```bash
/Users/ahrilab/.clawchat-remote/tailscale-local.sh up
```

If Tailscale says `Serve is not enabled on your tailnet`, approve it once in the admin UI and rerun the serve command.

After Tailscale login, expose the site to your tailnet only:

```bash
/Users/ahrilab/.clawchat-remote/tailscale-local.sh serve --bg http://127.0.0.1:8080
/Users/ahrilab/.clawchat-remote/tailscale-local.sh serve status
```

This exposes the Caddy site to your tailnet only. OpenClaw remains loopback-only.

Current tailnet URL:

```text
https://clawchat-mac.tailaa7944.ts.net/
```

When ClawChat is opened from that URL, the login screen should default the `Server URL` field to the same origin automatically.

## Mobile Checklist

1. Install Tailscale on the phone or tablet.
2. Sign in to the same tailnet as the Mac running ClawChat.
3. Open `https://clawchat-mac.tailaa7944.ts.net/` in the mobile browser.
4. Keep the prefilled `Server URL` unless you intentionally override it.
5. Enter the ClawChat PIN and verify the login page reports `Server reachable`.
6. If the page loads but cannot log in, run `/Users/ahrilab/.clawchat-remote/tailscale-local.sh serve status` on the Mac and verify `curl http://127.0.0.1:8000/api/health`.
7. If the `.ts.net` hostname does not resolve on mobile, confirm the device is actually connected to the same tailnet and MagicDNS is enabled.

## Credentials

- `PIN`, `JWT_SECRET`, and OpenClaw gateway token live in `clawchat_server/server/.env`
- If the Telegram bot token was exposed, rotate it in `@BotFather`
