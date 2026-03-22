# ClawChat

Privacy-first, self-hosted personal assistant — tasks, calendar, notes, and AI chat in one app.

## Quick Start (local)

```bash
make setup          # install frontend + backend dependencies, create .env
# edit .env with your settings (PIN, AI provider, etc.)
make dev            # start frontend on :5173 and backend on :8000
```

Requires **Node.js >= 18**, **Python >= 3.11**, and an OpenAI-compatible LLM endpoint (e.g. Ollama).

## Docker

```bash
cp .env.example .env   # then edit .env
docker compose up --build -d
```

### Docker with local LLM (Ollama)

```bash
docker compose --profile ollama up --build -d
docker compose exec ollama ollama pull llama3.2
```

When using the Ollama profile, set `AI_BASE_URL=http://ollama:11434` in your `.env`.

## Make Targets

| Target | Description |
|--------|-------------|
| `make setup` | Install all dependencies and create `.env` |
| `make dev` | Run frontend and backend concurrently |
| `make dev-frontend` | Run frontend only |
| `make dev-backend` | Run backend only |
| `make docker` | Build and start with Docker Compose |
| `make docker-ollama` | Same as above, plus a local Ollama container |
| `make test` | Run tests |
| `make typecheck` | TypeScript type checking |
| `make build` | Production build |
| `make clean` | Remove generated files and caches |

## Documentation

See [docs/](docs/README.md) for architecture, API design, database schema, deployment guides, and more.
