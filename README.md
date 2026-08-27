# ClawChat

Privacy-first, self-hosted AI project execution workspace for tasks, dependency
graphs, calendar, documents, agents, and chat.

ClawChat ships a shared web/Tauri client, a native Android app, and a provisional
Capacitor iOS shell. They connect to one FastAPI server and one SQLite database.

## Quick Start (local)

```bash
make setup          # install frontend + backend dependencies, create .env
# edit .env with your settings (PIN, AI provider, etc.)
make dev            # start frontend on :5173 and backend on :8000
```

Requires **Node.js >= 22** (Node 24 LTS recommended), **Python >= 3.11**, and
**uv 0.10.2**. AI features also require a configured backend such as Ollama, an
OpenAI-compatible endpoint, or Claude Code. Backend installs are reproduced from
the committed `server/uv.lock`.

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

## API Contracts

FastAPI owns the wire contract. After changing a server schema, regenerate the
checked-in OpenAPI snapshot and the generated TypeScript/Kotlin contracts:

```bash
npm run generate:api
uv run --project server --locked python scripts/export-openapi.py --check
npm run check:api-contract
```

The canonical task lifecycle is `pending`, `in_progress`, `completed`, or
`cancelled`. A task's blocked/readiness state is derived from dependencies and is
not a lifecycle status.

Task dependencies are normalized in `task_relationships` with referential,
uniqueness, and DAG-cycle validation. The legacy `todos.depends_on` JSON field
is maintained only as a temporary compatibility shadow.

## Documentation

See [docs/](docs/README.md) for architecture, API design, database schema, deployment guides, and more.
