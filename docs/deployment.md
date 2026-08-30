# Deployment

ClawChat server is deployed as a Docker Compose stack on the user's own infrastructure.

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
CODEX_MODEL=gpt-5.3-codex
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
# Optional; empty uses ~/.codex/config.toml
CODEX_CLI_MODEL=
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
| `CODEX_API_BASE_URL` | `https://api.openai.com/v1` | OpenAI Responses API base URL |
| `CODEX_API_KEY` | *(empty)* | OpenAI API key for Codex; falls back to `OPENAI_API_KEY` |
| `CODEX_API_KEY_FILE` | *(empty)* | Optional owner-only file used to persist the Codex API key |
| `CODEX_MODEL` | `gpt-5.3-codex` | Codex model used for chat, planning, and tool calls |
| `CODEX_REASONING_EFFORT` | `medium` | Codex reasoning effort: `low`, `medium`, `high`, or `xhigh` |
| `CODEX_CLI_MODEL` | *(empty)* | Optional Codex CLI model; empty uses the CLI config default |
| `PASEO_ENABLED` | `false` | Enable the optional Paseo execution adapter |
| `PASEO_CLI_COMMAND` | `paseo` | Official Paseo CLI command available to the server process |
| `PASEO_HOST` | *(empty)* | Optional daemon target; supports host:port or an E2EE offer URL |
| `PASEO_DEFAULT_PROVIDER` | `codex` | Default Paseo provider/model identifier |
| `PASEO_POLL_INTERVAL_SECONDS` | `3` | External agent status polling interval |
| `PASEO_COMMAND_TIMEOUT_SECONDS` | `30` | Per-command timeout, except transcript collection |
| `PASEO_RECONNECT_GRACE_SECONDS` | `120` | Daemon outage tolerated before a run fails |
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

# Optional coding-agent execution through a local Paseo daemon
# PASEO_ENABLED=true
# PASEO_CLI_COMMAND=paseo
# PASEO_DEFAULT_PROVIDER=codex/gpt-5.5

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
4. **For HTTPS** (recommended): Place a reverse proxy (Nginx, Caddy) in front of the server with a self-signed or Let's Encrypt certificate

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
