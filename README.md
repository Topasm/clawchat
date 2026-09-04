# ClawChat

**A privacy-first, self-hosted agentic todo app.**

ClawChat goes beyond storing todos: it helps turn captured work into structured
plans, finds the next ready task, runs approved work with AI agents, and routes the
result back to you for review. Tasks, projects, dependency graphs, calendar,
documents, and chat stay connected in one workspace.

You keep control of the workflow and the data. ClawChat can run on your own FastAPI
server and SQLite database, with shared web and Tauri clients plus a native Android
app. Android can also start as a standalone, on-device todo workspace with no
server account or PIN, then connect to a server later when you want shared projects
and agent features.

## What makes it agentic?

- **Plan** — Turn goals and inbox captures into projects, workstreams, subtasks, and
  dependency-aware execution plans.
- **Act** — Run a ready task with Claude Code, the local Codex CLI, the Codex
  Responses API, OpenClaw, or another configured AI backend.
- **Review** — Inspect agent runs and artifacts, approve the result, and see which
  downstream tasks become ready next.
- **Stay in control** — Preview consequential changes, require explicit approval,
  and keep the entire workspace on infrastructure you own.

## Quick Start (self-hosted development)

```bash
make setup          # install frontend + backend dependencies, create .env
# edit .env with your settings (PIN, AI provider, etc.)
make dev            # start frontend on :5173 and backend on :8000
```

Requires **Node.js >= 22** (Node 24 LTS recommended), **Python >= 3.11**, and
**uv 0.10.2**. AI features also require a configured backend such as Ollama, an
OpenAI-compatible endpoint, Claude Code, the Codex CLI, or the OpenAI Codex
Responses API.
Backend installs are reproduced from the committed `server/uv.lock`.

### Android: local or connected

On first launch, choose **Use on this device** for a compact offline todo,
calendar, search, reminder, share-capture, and widget experience backed only by
the phone's Room database. Choose **Connect a workspace** for synchronized data,
chat, Review Inbox, and agent-run controls. A remembered server session can be
switched off while local mode is active and reactivated without entering the PIN
again. The native Android interface follows the device language and includes
English and Korean resources.

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
