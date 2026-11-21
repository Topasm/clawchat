# Deployment

ClawChat server is deployed as a Docker Compose stack on the user's own infrastructure, or served by the desktop app in host mode. A Linux desktop host can keep serving after logout; see [Desktop Host Without a Login](#desktop-host-without-a-login-linux).

## Dockerfile

```dockerfile
# server/Dockerfile
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.10.2 /uv /uvx /bin/

WORKDIR /app

# Install the locked runtime dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

# Copy application code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Start server (init_db runs automatically in FastAPI lifespan)
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Docker Compose

```yaml
# docker-compose.yml
version: "3.8"

services:
  server:
    build: ./server
    ports:
      - "${PORT:-8000}:8000"
    volumes:
      - clawchat-data:/app/data
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test:
        [
          "CMD",
          "/app/.venv/bin/python",
          "-c",
          "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=5).read()",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  clawchat-data:
    driver: local
```

### With Ollama (local LLM)

The Ollama service is defined in the same `docker-compose.yml` using a [Docker Compose profile](https://docs.docker.com/compose/how-tos/profiles/). Activate it with `--profile ollama`:

```bash
docker compose --profile ollama up --build -d

# Pull a model (first time only)
docker compose exec ollama ollama pull llama3.2
```

Set `AI_PROVIDER=ollama` and `AI_BASE_URL=http://ollama:11434` in `.env`.

### Codex API

Codex uses OpenAI's Responses API rather than the OpenAI-compatible gateway
configured by `AI_BASE_URL`. To select it at startup:

```bash
AI_PROVIDER=codex
CODEX_API_KEY=your-openai-api-key
CODEX_MODEL=gpt-6-sol
```

`OPENAI_API_KEY` can be used instead of `CODEX_API_KEY`. In the desktop app,
you can also enter the key under **Workspace Settings → AI → OpenAI API key**;
ClawChat validates the credential before saving it to the protected app-data
credential file.

### Codex CLI

To reuse an existing local Codex login without storing an API key in ClawChat:

```bash
codex login
AI_PROVIDER=codex_cli
# Defaults to the cheaper Luna tier; empty uses ~/.codex/config.toml
CODEX_CLI_MODEL=gpt-6-luna
```

ClawChat runs `codex exec` non-interactively with a read-only sandbox, disabled
approval prompts, and ephemeral sessions. This option is intended for native or
local server installs where the `codex` executable and login are available; it
is not included in the Docker image.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `DEBUG` | `false` | Enable debug mode (verbose logging, auto-reload) |
| `DATABASE_URL` | `sqlite:///./data/clawchat.db` | SQLite database path |
| `JWT_SECRET` | *(required)* | Secret key for JWT token signing |
| `JWT_EXPIRY_HOURS` | `24` | JWT token expiration time |
| `PIN` | *(required)* | User PIN for authentication |
| `AI_PROVIDER` | `ollama` | AI provider: `ollama`, `openai`, `claude_code`, `codex_cli`, or `codex` |
| `AI_BASE_URL` | `http://localhost:11434` | AI provider API base URL |
| `AI_API_KEY` | *(empty)* | Optional bearer token for the OpenAI-compatible gateway |
| `AI_MODEL` | `llama3.2` | Model name to use |
| `AI_PROVIDER_FALLBACK` | `true` | Activate another ready provider when the configured one is unreachable |
| `AI_PROVIDER_FILE` | *(empty)* | File remembering the provider picked in the app; overrides `AI_PROVIDER` |
| `CODEX_API_BASE_URL` | `https://api.openai.com/v1` | OpenAI Responses API base URL |
| `CODEX_API_KEY` | *(empty)* | OpenAI API key for Codex; falls back to `OPENAI_API_KEY` |
| `CODEX_API_KEY_FILE` | *(empty)* | Optional owner-only file used to persist the Codex API key |
| `CODEX_MODEL` | `gpt-6-sol` | Codex model used for chat, planning, and tool calls |
| `CODEX_REASONING_EFFORT` | `medium` | Codex reasoning effort: `low`, `medium`, `high`, or `xhigh` |
| `CODEX_CLI_MODEL` | `gpt-6-luna` | Codex CLI model; empty uses the CLI config default |
| `CLAUDE_CODE_MODEL` | `sonnet` | Model alias passed to `claude --model`; empty uses the CLI default |
| `ORCA_ENABLED` | `false` | Enable the optional Orca execution adapter |
| `ORCA_MANAGE_RUNTIME` | `true` | ClawChat starts, restarts and stops its own `orca-ide serve` (127.0.0.1, pairing off) in a private profile, with Orca's agent hooks off and worktrees kept inside the profile; `false` connects to an `orca-ide serve` you run yourself |
| `ORCA_CLI_COMMAND` | `orca-ide` | Orca CLI command available to the server process (never bare `orca` on Linux: that is the screen reader) |
| `ORCA_USER_DATA_PATH` | *(empty)* | Orca profile directory; empty is `orca` next to `UPLOAD_DIR` when managed, Orca's own default when not |
| `ORCA_RUNTIME_PORT` | `0` | Port for ClawChat's Orca (bound to 127.0.0.1); `0` picks a free port on each start |
| `ORCA_STARTUP_TIMEOUT_SECONDS` | `60` | How long ClawChat's Orca may take to become ready before it is restarted |
| `ORCA_AGENT` | `codex` | Orca agent id each run's chat uses (`orca-ide agent installed` lists them) |
| `ORCA_MODEL` | *(empty)* | Model for that agent; empty picks the CLI's cheap tier |
| `ORCA_PERMISSION_MODE` | `auto` | `auto` (workspace writes, agent's reviewer judges escalations) or `ask` (read-only, every escalation waits for you) |
| `ORCA_POLL_INTERVAL_SECONDS` | `3` | Chat status polling interval |
| `ORCA_COMMAND_TIMEOUT_SECONDS` | `30` | Per-command timeout |
| `ORCA_RECONNECT_GRACE_SECONDS` | `120` | Orca outage tolerated before a run fails |
| `ORCA_RUN_TIMEOUT_SECONDS` | `3600` | Longest a run may work before its turn is stopped |
| `UPLOAD_DIR` | `data/uploads` | Directory for uploaded attachment files |
| `MAX_UPLOAD_SIZE_MB` | `10` | Maximum file upload size in MB |
| `ALLOWED_EXTENSIONS` | `jpg,jpeg,...,zip` | Comma-separated allowed file extensions |
| `PUBLIC_URL` | *(empty)* | Public-facing URL for reverse proxy deployments (used in pairing QR codes) |
| `RELAY_URL` | *(empty)* | Optional ClawChat E2EE relay URL; enables automatic remote fallback without opening an inbound port |
| `VITE_DEFAULT_SERVER_URL` | *(empty)* | Build-time frontend default server URL (login page) |
| `ENABLE_SCHEDULER` | `true` | Enable background scheduler |
| `BRIEFING_TIME` | `08:00` | Daily briefing time (HH:MM, 24h) |
| `REMINDER_CHECK_INTERVAL` | `60` | Seconds between reminder checks |

### Example `.env` File

```bash
# .env
JWT_SECRET=change-this-to-a-random-string
PIN=123456
AI_PROVIDER=ollama
AI_BASE_URL=http://ollama:11434
AI_MODEL=llama3.2
ENABLE_SCHEDULER=true
BRIEFING_TIME=08:00

# Optional coding-agent execution through Orca on this machine. ClawChat starts
# and supervises its own `orca-ide serve`; set ORCA_MANAGE_RUNTIME=false to use
# one you run yourself.
# ORCA_ENABLED=true
# ORCA_CLI_COMMAND=/opt/orca-server/bin/orca-ide

# Remote access (set when using Cloudflare Tunnel or reverse proxy)
# PUBLIC_URL=https://clawchat.example.com
# VITE_DEFAULT_SERVER_URL=https://clawchat.example.com
```

## Volume Management

The SQLite database is stored in a Docker named volume (`clawchat-data`) to persist across container restarts and updates.

```bash
# Backup database
docker cp $(docker compose ps -q server):/app/data/clawchat.db ./backup-clawchat.db

# Restore database
docker cp ./backup-clawchat.db $(docker compose ps -q server):/app/data/clawchat.db
docker compose restart server

# List volumes
docker volume ls | grep clawchat
```

## Local Network Setup

For the mobile app to reach the server on a local network:

> **Note:** The Tauri desktop app binds its embedded server to `127.0.0.1` by default. Enable **Allow local network access** in workspace settings and replace the default PIN when mobile clients need LAN access, or use Docker/manual `uvicorn --host 0.0.0.0`. For remote access, use Cloudflare Tunnel or Tailscale rather than exposing the port directly.

1. **Find the server's local IP**: Run `ip addr` (Linux) or `ipconfig` (Windows) on the host machine
2. **Configure the firewall**: Allow inbound TCP on port 8000
3. **Enter the URL in the app**: `http://192.168.x.x:8000` (use the actual IP)
4. **For HTTPS** (recommended): Place a reverse proxy (Nginx, Caddy) in front of the server with a self-signed or Let's Encrypt certificate. A server reachable from the internet over plain HTTP sends the PIN and every token in the clear.

What an exposed server refuses on its own:

- **The default PIN from another machine.** While `PIN` is still `123456`, sign-in with it works only from the server's own machine; every other caller gets `403` with reason `default_pin_remote_login`. Devices that were already paired keep working. Set `PIN` to something else.
- **The API description.** `/docs`, `/redoc` and `/openapi.json` are served only with `DEBUG=true`.
- **Details in `/api/health`.** Without a token it reports only what a client needs to recognise the server and compare versions; the AI model and CLI versions are for signed-in clients.
- **Repeated wrong PINs.** Five failures in five minutes lock that caller out, for longer each time (`LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_SECONDS`).

### Caddy Reverse Proxy Example

```yaml
# Add to docker-compose.yml
services:
  caddy:
    image: caddy:latest
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    depends_on:
      - server

volumes:
  caddy-data:
```

```
# Caddyfile
your-domain.com {
    reverse_proxy server:8000
}
```

## Desktop Host Without a Login (Linux)

A desktop app in host mode serves phones and workers only while its window runs. Logging out stops the server, and the app cannot start again until someone logs in. On a Linux machine that other devices depend on, run the same server from a systemd user service. It starts at boot and keeps serving whether or not anyone is logged in ([ADR 021](./adr/021-headless-desktop-host.md)).

`ClawChat.AppImage --server-only` runs the bundled server without a window. It uses the app's own data folder and the settings chosen in the app: port, PIN and LAN access. Open the app once and set those first. Without them, the server answers only on this machine, with the default PIN.

1. Give the AppImage a path that survives upgrades, and point the app-menu launcher (`Exec=` in `~/.local/share/applications/clawchat.desktop`) at the same path:

   ```bash
   ln -sfn ~/Applications/ClawChat-<version>.AppImage ~/Applications/ClawChat.AppImage
   ```

2. Keep your user's services running without a login:

   ```bash
   loginctl enable-linger "$USER"
   ```

3. Create `~/.config/systemd/user/clawchat.service`:

   ```ini
   [Unit]
   Description=ClawChat server

   [Service]
   ExecStart=%h/Applications/ClawChat.AppImage --server-only
   # Whatever the app-menu launcher sets, such as the AI provider.
   Environment=AI_PROVIDER=codex_cli
   # Where the server finds the CLIs it runs (codex, claude). A service does
   # not read your shell profile, so list the folders here.
   Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
   # Always, not on-failure: changing the PIN, port or LAN access in the app
   # stops this server so it comes back with the new settings.
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

   With the `.deb` package, use `ExecStart=/usr/bin/clawchat-tauri --server-only`. If the AppImage cannot mount because FUSE is missing, add `Environment=APPIMAGE_EXTRACT_AND_RUN=1`.

4. Start it, now and at every boot:

   ```bash
   systemctl --user daemon-reload
   ```

   ```bash
   systemctl --user enable --now clawchat
   ```

5. Check it:

   ```bash
   systemctl --user status clawchat
   ```

   ```bash
   curl -s http://127.0.0.1:8000/api/health
   ```

The server's output goes to `~/.local/share/com.clawchat.desktop/server.log`, as it does under the app. The launcher's own messages, such as a refused setting or "waiting for it to stop", are in `journalctl --user -u clawchat`.

**Living with the app.** Only one server ever runs per database. The server locks `server-data/data/clawchat.db.lock`, and a second one refuses to start. With the service running, the app uses the service's server instead of starting its own, and leaves it running when you quit. If the app was serving first, the service waits and takes over a few seconds after the app quits. A PIN, port or LAN change in the app restarts the server. Whichever starts next, the service or the app, uses the new settings.

**Upgrading.** Point the link at the new AppImage and restart the service. An in-app update replaces the AppImage file, but the running server stays on the old version until it restarts.

```bash
ln -sfn ~/Applications/ClawChat-<new-version>.AppImage ~/Applications/ClawChat.AppImage
```

```bash
systemctl --user restart clawchat
```

**Trying it on a copy first.** `--data-dir` points the server at another data folder. Copy `server-config.json` into a new folder. In the copy, set a spare `port`, `"lanAccess": false` and an empty `"obsidianVaultPath"`, so the rehearsal cannot reach your phone or write to your vault. Then copy the database with SQLite's backup API, never as a plain file while a server runs:

```bash
mkdir -p /path/to/copy/server-data/data
```

```bash
python3 -c 'import sqlite3, sys; sqlite3.connect(sys.argv[1]).backup(sqlite3.connect(sys.argv[2]))' ~/.local/share/com.clawchat.desktop/server-data/data/clawchat.db /path/to/copy/server-data/data/clawchat.db
```

```bash
~/Applications/ClawChat.AppImage --server-only --data-dir /path/to/copy
```

**Removing it.** The app goes back to starting its own server.

```bash
systemctl --user disable --now clawchat
```

## Calendar Subscription URLs in Logs

The calendar feed at `/api/events/feed/<token>.ics` authenticates by URL,
because a calendar app cannot send an `Authorization` header. The URL is
therefore a credential, and anything that logs request paths logs a working
one on every poll.

The server redacts the token from its own uvicorn access log. **A reverse proxy
in front of it does not** — Nginx `access_log` and Caddy's logger both record
the full path by default. Either drop the path for that route or turn its
access log off:

```caddy
# Caddyfile — inside the site block
@calendar_feed path /api/events/feed/*
log_skip @calendar_feed
```

```nginx
# nginx — inside the server block
location ^~ /api/events/feed/ {
    access_log off;
    proxy_pass http://clawchat:8000;
}
```

If a subscription URL does leak, revoke it with
`DELETE /api/events/subscription`; issuing a new one also invalidates the old
immediately.

## Remote Access

ClawChat supports three remote access methods. With a tunnel, only the reverse proxy
(`127.0.0.1:8080`) is exposed; the FastAPI server and any AI gateway remain loopback-only.
The E2EE relay uses an outbound host connection and exposes no desktop port.

| Method | Audience | Requires |
|--------|----------|----------|
| **ClawChat E2EE relay** | Seamless mobile fallback | Relay service + `RELAY_URL`; see [E2EE mobile relay](./e2ee-relay.md) |
| **Cloudflare Tunnel** (recommended) | Public HTTPS, any device | Cloudflare account + domain |
| **Tailscale Serve** | Tailnet-only (private) | Tailscale on both host and client |

Set `PUBLIC_URL` and `VITE_DEFAULT_SERVER_URL` in `.env` to the public hostname so pairing QR codes, login defaults, and API responses use the correct address:

```bash
PUBLIC_URL=https://clawchat.example.com
VITE_DEFAULT_SERVER_URL=https://clawchat.example.com
```

Rebuild the frontend (`npm run build`) after changing `VITE_DEFAULT_SERVER_URL`.

See the [Remote Access Runbook](./remote-access-runbook.md) for step-by-step setup of both options.

## Browser and Mobile Access Checklist

When testing from a phone or tablet:

1. Open the ClawChat URL in a browser, or configure the same HTTPS server URL in the native Android app.
2. Leave the `Server URL` field as the prefilled site URL unless you intentionally changed it.
3. Enter the ClawChat PIN and confirm the health indicator shows the server is reachable.
4. If the app loads but login fails, verify the reverse proxy and tunnel are running on the host, and that `curl http://127.0.0.1:8080/api/health` succeeds locally.
5. For Tailscale: ensure the mobile device is connected to the same tailnet and MagicDNS is enabled.

## Dev vs Production

| Aspect | Development | Production |
|--------|-------------|------------|
| Server | `uvicorn --reload` | Docker Compose |
| Database | Local SQLite file | Docker volume |
| AI Provider | Ollama (local) | Ollama or cloud API |
| HTTPS | Not required (localhost) | Required (Caddy/Nginx) |
| Debug mode | `DEBUG=true` | `DEBUG=false` |
| JWT secret | Any string | Strong random string |
| Logging | Verbose (stdout) | Structured (file/service) |

### Quick Start

```bash
# 1. Clone the repo
git clone <repo-url> && cd clawchat

# 2. Copy environment config
cp .env.example .env
# Edit .env with your JWT_SECRET and PIN

# 3. Launch (with local Ollama)
docker compose --profile ollama up -d

# 4. Pull an AI model (first time only)
docker compose exec ollama ollama pull llama3.2

# 5. Verify
curl http://localhost:8000/api/health
# {"status":"ok","version":"0.1.0","ai_provider":"ollama","ai_model":"llama3.2"}

# 6. Connect a client
# Open ClawChat -> enter http://<your-ip>:8000 (or the HTTPS public URL) -> enter PIN
```
