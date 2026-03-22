# Deployment

ClawChat server is deployed as a Docker Compose stack on the user's own infrastructure.

## Dockerfile

```dockerfile
# server/Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Start server (init_db runs automatically in FastAPI lifespan)
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
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
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
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
| `AI_PROVIDER` | `ollama` | AI provider: `ollama` or `openai` |
| `AI_BASE_URL` | `http://localhost:11434` | AI provider API base URL |
| `AI_API_KEY` | *(empty)* | API key (required for OpenAI/Claude) |
| `AI_MODEL` | `llama3.2` | Model name to use |
| `UPLOAD_DIR` | `data/uploads` | Directory for uploaded attachment files |
| `MAX_UPLOAD_SIZE_MB` | `10` | Maximum file upload size in MB |
| `ALLOWED_EXTENSIONS` | `jpg,jpeg,...,zip` | Comma-separated allowed file extensions |
| `PUBLIC_URL` | *(empty)* | Public-facing URL for reverse proxy deployments (used in pairing QR codes) |
| `VITE_DEFAULT_SERVER_URL` | *(empty)* | Build-time frontend default server URL (login page, Capacitor app) |
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

> **Note:** The Electron desktop app binds the embedded server to `127.0.0.1` (loopback only) for security. Direct LAN access (`http://192.168.x.x:8000`) only works with Docker or manual `uvicorn --host 0.0.0.0` deployments. For Electron, use a reverse proxy + Cloudflare Tunnel or Tailscale instead (see [Remote Access](#remote-access)).

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

## Remote Access

ClawChat supports two remote access methods. In both cases only the reverse proxy (`127.0.0.1:8080`) is exposed; the FastAPI server and any AI gateway remain loopback-only.

| Method | Audience | Requires |
|--------|----------|----------|
| **Cloudflare Tunnel** (recommended) | Public HTTPS, any device | Cloudflare account + domain |
| **Tailscale Serve** | Tailnet-only (private) | Tailscale on both host and client |

Set `PUBLIC_URL` and `VITE_DEFAULT_SERVER_URL` in `.env` to the public hostname so pairing QR codes, login defaults, and API responses use the correct address:

```bash
PUBLIC_URL=https://clawchat.example.com
VITE_DEFAULT_SERVER_URL=https://clawchat.example.com
```

Rebuild the frontend (`npm run build`) after changing `VITE_DEFAULT_SERVER_URL`.

See the [Remote Access Runbook](./remote-access-runbook.md) for step-by-step setup of both options.

## Mobile Access Checklist

When testing from a phone or tablet:

1. Open the ClawChat URL in the mobile browser (e.g. `https://clawchat.example.com/`).
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

# 6. Connect the mobile app
# Open ClawChat app -> Enter server URL: http://<your-ip>:8000 -> Enter PIN
```
