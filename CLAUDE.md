# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawChat is a privacy-first, self-hosted personal assistant that unifies task management, calendar, and AI-powered chat into a cross-platform app (web, Electron desktop, Capacitor mobile). Single server, single SQLite database.

## Setup & Development

```bash
make setup                  # Install frontend + backend deps, create .env
make dev                    # Start frontend (:5173) + backend (:8000) together
```

Or use npm directly:
```bash
npm run dev:full            # Same as make dev (uses concurrently)
npm run dev                 # Frontend only (Vite)
npm run dev:electron        # Electron + Vite (desktop)
npm run test                # Run all Vitest tests
npm run typecheck           # TypeScript check (tsconfig.app.json)
npm run build               # Typecheck + production web build
```

Single test file: `npx vitest run src/app/stores/__tests__/useAuthStore.test.ts`

Backend only: `make dev-backend` or `cd server && . venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000`

### Docker

```bash
docker compose up --build -d                    # Server only (BYO LLM)
docker compose --profile ollama up --build -d   # Server + Ollama
```

Server config is via environment variables (see `.env.example`). Key vars: `AI_PROVIDER` (ollama/openai), `AI_BASE_URL`, `AI_MODEL`, `PIN`. `JWT_SECRET` auto-generates if not set. For remote access: `PUBLIC_URL` (backend, used in pairing QR codes), `VITE_DEFAULT_SERVER_URL` (frontend build-time default).

## Architecture

### Two-process system

- **Frontend:** React 18 + TypeScript, built with Vite. Runs in browser, Electron, or Capacitor WebView.
- **Backend:** Python FastAPI async server. Communicates via REST + SSE (streaming chat) + WebSocket (real-time sync).

### Frontend (`src/`)

- **Pages** (`src/app/pages/`): Today, Chat, Kanban, Calendar, Settings, Admin, etc.
- **State**: Zustand stores (`src/app/stores/`) for auth, chat, modules (todos/events), settings, toasts. Server state via TanStack React Query (`src/app/hooks/`).
- **API layer**: Axios client with JWT token refresh (`src/app/services/apiClient.ts`), SSE client for streaming chat, WebSocket client for real-time.
- **Styling**: Plain CSS with BEM naming using `.cc-` prefix. Theme via CSS custom properties. Files in `src/styles/`.
- **TypeScript config**: Multi-project — `tsconfig.app.json` (frontend), `tsconfig.electron.json` (Electron main process). Root `tsconfig.json` is a project reference file only.
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
- **Schemas** (`server/schemas/`): Pydantic request/response schemas with Zod equivalents on frontend (`src/app/types/`).
- **Auth**: PIN-based login, JWT tokens (`server/auth/`).

### AI Data Flow

User message → SSE stream to `/api/chat/stream` → intent classification via LLM function calling → orchestrator dispatches to service (todo/calendar/etc.) → DB update → streamed response back to client.

### Electron (`electron/`)

Main process (`main.ts`) + preload script (`preload.ts`) with IPC bridge for secure storage, Obsidian vault access, and desktop notifications.

### Android (`android/`)

Native Kotlin + Jetpack Compose app. Multi-module Gradle project (app, core, feature modules, widget). Uses Hilt DI, Retrofit/OkHttp, DataStore, Navigation Compose. Connects to the backend via REST + SSE. Pairs with desktop via 6-digit code or QR, or falls back to PIN login.

### iOS (`ios/`)

Capacitor wraps the web build. Capacitor plugins: local notifications, keyboard, preferences, splash screen.

## Key Conventions

- CSS class prefix: `.cc-` (e.g., `.cc-chat-panel`, `.cc-kanban-board`)
- Frontend path alias: none configured — use relative imports
- Backend runs from `server/` directory; imports are relative to that root
- Schemas are duplicated: Pydantic on backend, Zod on frontend — keep in sync
- Docker deployment: single `docker-compose.yml` with `--profile ollama` for local LLM
