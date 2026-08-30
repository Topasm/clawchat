# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawChat is a privacy-first, self-hosted agentic todo app that turns captured work into structured plans, runs approved ready tasks with AI agents, and routes results through human review. It unifies tasks, graphs, calendar, documents, agents, and chat across web, Tauri desktop, and native Android clients backed by one FastAPI server and one SQLite database.

## Setup & Development

```bash
make setup                  # Install frontend + backend deps, create .env
make dev                    # Start frontend (:5173) + backend (:8000) together
```

Or use npm directly:
```bash
npm run dev:full            # Same as make dev (uses concurrently)
npm run dev                 # Frontend only (Vite)
npm run dev:tauri           # Tauri + Vite (desktop)
npm run test                # Run all Vitest tests
npm run typecheck           # TypeScript check (tsconfig.app.json)
npm run build               # Typecheck + production web build
npm run generate:api        # Refresh OpenAPI plus generated TS/Kotlin contracts
```

Single test file: `npx vitest run src/app/stores/__tests__/useAuthStore.test.ts`

Backend only: `make dev-backend` or `uv run --project server --locked uvicorn main:app --app-dir server --reload --host 0.0.0.0 --port 8000`

### Docker

```bash
docker compose up --build -d                    # Server only (BYO LLM)
docker compose --profile ollama up --build -d   # Server + Ollama
```

Server config is via environment variables (see `.env.example`). Key vars: `AI_PROVIDER` (`ollama`, `openai`, `claude_code`, or `codex`), `AI_BASE_URL`, `AI_MODEL`, `CODEX_API_KEY`/`OPENAI_API_KEY`, `CODEX_MODEL`, and `PIN`. `JWT_SECRET` auto-generates if not set. For remote access: `PUBLIC_URL` (backend, used in pairing QR codes), `VITE_DEFAULT_SERVER_URL` (frontend build-time default).

## Architecture

### Two-process system

- **Frontend:** React 18 + TypeScript, built with Vite. Runs in browsers and Tauri. iOS is not a supported target.
- **Backend:** Python FastAPI async server. Communicates via REST + SSE (streaming chat) + WebSocket (real-time sync).

### Frontend (`src/`)

- **Pages** (`src/app/pages/`): Today, Chat, Kanban, Calendar, Settings, Admin, etc.
- **State**: Zustand stores (`src/app/stores/`) for auth, chat, modules (todos/events), settings, toasts. Server state via TanStack React Query (`src/app/hooks/`).
- **API layer**: Axios client with JWT token refresh (`src/app/services/apiClient.ts`), SSE client for streaming chat, WebSocket client for real-time.
- **Styling**: Plain CSS with BEM naming using `.cc-` prefix. Theme via CSS custom properties. Files in `src/styles/`.
- **TypeScript config**: `tsconfig.app.json` covers the renderer. Root `tsconfig.json` references that project.
- **Tests**: Vitest + jsdom + Testing Library. Tests live in `__tests__/` directories adjacent to source. Setup in `src/test/setup.ts`.

### Backend (`server/`)

- **Routers** (`server/routers/`): auth, chat, todo, tasks, calendar, search, admin, attachment, obsidian, etc.
- **Services** (`server/services/`): Business logic layer. Key services:
  - `ai_service.py` — LLM client (Ollama or OpenAI-compatible)
  - `intent_classifier.py` — Classifies user intent via LLM function calling
  - `orchestrator.py` — Routes classified intents to appropriate service
  - `scheduler.py` — Background tasks (reminders, daily briefing, queue flush)
  - `inbox_pipeline_service.py` — Inbox classification + skill suggestion
- **Skills** (`server/skills/`): Composable agent capabilities (registry pattern). Built-in skills: plan, research, summarize, draft, code_review, data_analysis, obsidian_sync, prioritize. Skills are chained on AgentTask and executed sequentially.
  - `obsidian_cli_service.py` — Obsidian CLI wrapper (official `key=value` syntax) + write queue
  - `obsidian_context_service.py` / `obsidian_export_service.py` / `obsidian_vault_indexer.py` — Vault integration
- **Models** (`server/models/`): SQLAlchemy async ORM models (conversation, message, todo, event, attachment, etc.)
- **Schemas** (`server/schemas/`): Pydantic request/response schemas. FastAPI OpenAPI is snapshotted in `server/openapi.json`; canonical runtime contracts such as `TaskStatus` and `TaskRelationshipType` are generated for TypeScript and Kotlin.
- **Auth**: PIN-based login, JWT tokens (`server/auth/`).

### AI Data Flow

User message → SSE stream to `/api/chat/stream` → intent classification via LLM function calling → orchestrator dispatches to service (todo/calendar/etc.) → DB update → streamed response back to client.

### Tauri (`src-tauri/`)

The Rust shell supervises the FastAPI sidecar and provides secure storage, tray, updater, Obsidian, notification, and desktop lifecycle commands through `src/app/platform/`.

### Android (`android/`)

Native Kotlin + Jetpack Compose app. Multi-module Gradle project (app, core, feature modules, widget). Uses Hilt DI, Retrofit/OkHttp, DataStore, Navigation Compose. Connects to the backend via REST + SSE. Pairs with desktop via 6-digit code or QR, or falls back to PIN login.

## Key Conventions

- CSS class prefix: `.cc-` (e.g., `.cc-chat-panel`, `.cc-kanban-board`)
- Frontend path alias: none configured — use relative imports
- Backend runs from `server/` directory; imports are relative to that root
- Run `npm run generate:api` after a server contract change; never hand-edit generated TypeScript/Kotlin runtime enum values
- Task status is server-owned: `pending | in_progress | completed | cancelled`; `blocked` is derived from dependencies
- Task relationships are server-owned rows in `task_relationships`; for `depends_on`, source is the dependent task and target is its prerequisite. `todos.depends_on` is a deprecated compatibility shadow, not a client read model
- Relationship provenance is server-owned. Preserve retained edge IDs/metadata, validate the whole DAG, and keep the durable migration marker atomic with legacy import
- Docker deployment: single `docker-compose.yml` with `--profile ollama` for local LLM
