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

# Run migrations and start server
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
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

```yaml
# docker-compose.ollama.yml
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
    environment:
      - AI_PROVIDER=ollama
      - AI_BASE_URL=http://ollama:11434
    depends_on:
      - ollama
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-models:/root/.ollama
    restart: unless-stopped

volumes:
  clawchat-data:
    driver: local
  ollama-models:
    driver: local
```

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
docker compose -f docker-compose.ollama.yml up -d

# 4. Pull an AI model (first time only)
docker compose exec ollama ollama pull llama3.2

# 5. Verify
curl http://localhost:8000/api/health
# {"status":"ok","version":"0.1.0","ai_provider":"ollama","ai_model":"llama3.2"}

# 6. Connect the mobile app
# Open ClawChat app -> Enter server URL: http://<your-ip>:8000 -> Enter PIN
```
