# Architecture Overview

## System Diagram

```
┌─ ClawChat Desktop / Web App ───────────────────────────┐
│                                                          │
│   Platform Targets                                       │
│   ├── Tauri 2 (Windows, macOS, Linux)                    │
│   ├── Web Browser (Vite dev server / static build)       │
│   └── Native Android (Kotlin + Compose)                  │
│                                                          │
│   Pages                         State (Zustand)          │
│   ├── TodayPage                 ├── useAuthStore         │
│   ├── InboxPage                 ├── useChatStore         │
│   ├── ChatListPage              │   (streaming + CRUD)   │
│   ├── ChatPage                  ├── useModuleStore       │
│   ├── AllTasksPage (Kanban)     │   (todos, events,      │
│   ├── TaskDetailPage            │    kanban)              │
│   ├── EventDetailPage           └── useSettingsStore     │
│   ├── SettingsPage                  (15+ settings)       │
│   ├── SystemPromptPage                                   │
│   └── AdminPage (7-tab dashboard)                                   │
│                                                          │
│   Components                    Shared                   │
│   ├── Layout (sidebar + main)   ├── TaskCard             │
│   ├── kanban/                   ├── Badge                │
│   │   ├── KanbanBoard           ├── Checkbox             │
│   │   ├── KanbanColumn          ├── SectionHeader        │
│   │   └── KanbanCard            ├── EmptyState           │
│   ├── chat-panel/               ├── Icons (Calendar, Memo)│
│   │   ├── ChatPanel             ├── EventCard            │
│   │   ├── ChatInput             ├── SegmentedControl     │
│   │   ├── MessageBubble         ├── Toggle / Slider      │
│   │   └── StreamingIndicator    └── Settings components  │
│   └── ConversationItem                                   │
│                                                          │
│   Services                      Hooks                    │
│   ├── apiClient (Axios)         ├── useRegenerate        │
│   ├── sseClient (SSE)           ├── useDebouncedPersist  │
│   ├── wsClient (WebSocket)      ├── useTodayData         │
│   └── logger                    └── queries/ (React Q.)  │
│                                                          │
│   Styles (_*.css partials)      Utils                    │
│   ├── _reset, _variables        ├── formatters           │
│   ├── _layout, _components      ├── helpers (isDemoMode) │
│   ├── _chat, _pages, _kanban    └── platform detection   │
│   ├── _settings, _utilities                              │
│   └── _mobile                                            │
│                                                          │
└──────────────────────┬───────────────────────────────────┘
                       │ REST (HTTPS) + SSE Streaming
                       │ User's own server only
┌──────────────────────┼───────────────────────────────────┐
│  Self-Hosted Server  │                                    │
│                      │                                    │
│  FastAPI Backend  (server/)                                │
│  ├── Routers (chat, todo, tasks, calendar, attachment,    │
│  │           search, today, admin, obsidian, pairing,     │
│  │           settings, task relationships, change sets)   │
│  ├── Services (ai, orchestrator, todo, calendar,          │
│  │            planning/validation, inbox pipeline,        │
│  │            Vault outbox/export, claude code)           │
│  └── Models & Schemas (SQLAlchemy async + Pydantic)       │
│                                                           │
│  SQLite Database                                          │
│  ├── conversations, messages                              │
│  ├── todos, task_relationships, events, attachments       │
│  ├── task_graph_states, plan_proposals, change_sets       │
│  └── vault_sync_jobs, agent_tasks, devices, settings      │
│                                                           │
│  File Storage (data/uploads/)                             │
│  └── Uploaded attachments (UUID-named files)              │
│                                                           │
│  LLM Provider                                             │
│  └── Ollama (local) or OpenAI-compatible API (cloud)      │
│                                                           │
│  Obsidian Vault Integration (optional)                    │
│  ├── CLI wrapper (official key=value syntax)              │
│  ├── Vault indexer + project context                      │
│  ├── Export service (todos → markdown with @agent tags)   │
│  ├── Write queue (offline → replay on reconnect)          │
│  └── Sync: filesystem or LiveSync (CouchDB replication)  │
└───────────────────────────────────────────────────────────┘
```

## Design Principles

### 1. Self-Hosted & Privacy-First
All data stays on the user's server. The app communicates only with this server over HTTPS. No telemetry, no analytics, no third-party data processing.

### 2. Conversation as Interface
Natural language chat is the primary way users interact with all features. Direct manipulation UI (clicking, dragging) remains available as an alternative.

### 3. Unified Application Data
Todos, calendar events, messages, and conversations live in a single SQLite database, enabling cross-module awareness, full-text search, and traceability. Project documents remain user-owned Markdown files in an optional Obsidian vault and are integrated through indexing, context, and export services.

### 4. Deliberate Platform Boundaries
React + TypeScript is shared by the web and Tauri desktop targets. Native Android owns Android-specific UI, widgets, notifications, and background behavior. iOS is not a supported target; the provisional Capacitor shell was removed. Platform differences in the React application are handled through the neutral platform adapter. See [platform-matrix.md](./architecture/platform-matrix.md).

### 5. Local by Default, Cloud by Choice
The system works fully offline with demo data. Cloud services (LLM APIs, server sync) are optional enhancements.

## Data Flow

```
User sends message
    │
    ▼
App ──POST /api/chat/stream──► FastAPI Router
                                    │
                                    ▼
                              Intent Classifier
                              (LLM function call)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Module Service   General Chat    Agent Task
              (todo/calendar)  (AI response)   (async work)
                    │               │               │
                    ▼               ▼               ▼
              Execute CRUD    Stream tokens    Queue task
              Return result   via SSE          Notify later
                    │               │
                    └───────┬───────┘
                            ▼
                    App renders response
                    in chat panel

Inbox pipeline (new todos):
    Quick capture → classify via LLM → suggest persona
                                           │
                    ┌──────────────────────┼──────────────┐
                    ▼                      ▼              ▼
                 Planner             Researcher       Executor
              (break down)        (investigate)     (take action)
                    │                      │              │
                    ▼                      ▼              ▼
              Create subtasks      Research report    Execute + update
              Export to vault      Export to vault    Export to vault

Inbox placement (same Task identity):
    Capture → select one or many → Project / parent / sibling position
                                 │
                                 ▼
                 one revision-guarded transaction
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
          Tree/List/Kanban   Graph insights   conservative Undo
```

## CSS Architecture

All styles use **BEM naming** with a `.cc-` prefix (ClawChat) to avoid collisions:
- Colors are injected as CSS custom properties on `.cc-root` from the theme bridge
- Partials are organized by concern: `_layout.css`, `_components.css`, `_chat.css`, `_kanban.css`, etc.
- Light and dark themes swap CSS variable values — components reference variables, never hardcoded colors
- Responsive breakpoints handle desktop-to-mobile transitions (e.g., kanban columns stack at 768px)

## State Management

Five Zustand stores manage all client state:

| Store | Responsibility |
|-------|---------------|
| `useAuthStore` | JWT tokens, server URL, login/logout (persisted to localStorage) |
| `useChatStore` | Conversations, messages, SSE streaming, abort controller |
| `useModuleStore` | Local todo/event view preferences and kanban filters |
| `useSettingsStore` | Theme, chat behavior, LLM params, panel sizes, notifications (persisted to localStorage) |
| `useToastStore` | Toast notification queue with auto-dismiss (success/error/info/warning) |

All stores use optimistic updates with server sync. Demo data is seeded when no server is configured.

A `keyboard/` module provides centralized shortcut definitions (`registry.ts`) and semantic hooks (`hooks.ts`) for global, kanban, and navigation shortcuts using `react-hotkeys-hook`.

### State Management Architecture

The architecture splits state responsibilities between specialized tools (completed in Phase 2):

| Layer | Tool | Responsibility |
|-------|------|---------------|
| **Server state** | TanStack Query (React Query) | Handles API data fetching, caching, background refetch, and optimistic mutations |
| **UI state** | Zustand | Manages filters, panel sizes, theme, and local-only preferences |
| **Validation** | Zod | Validates API responses and form inputs at runtime |

This mirrors the pattern used in production by vibe-kanban, where Zustand handles UI preferences and React Query handles all server-side data with intelligent caching. See [roadmap.md](./roadmap.md) Phase 2 for details.

## Canonical Task Lifecycle

Task lifecycle state is server-owned and persisted in `todos.status`:

```text
pending | in_progress | completed | cancelled
```

Web, Tauri, and Android read that value directly. Zustand does not override task status. `blocked` is not a lifecycle value; it is derived from incomplete dependencies. FastAPI publishes the enum in OpenAPI, and checked-in TypeScript and Kotlin contracts are generated from that schema. See [ADR 003](./adr/003-task-status-source-of-truth.md).

Task links are server-owned rows in `task_relationships`. For a `depends_on`
edge, the source is the task being executed and the target is its prerequisite;
`blocks` is derived by reversing that edge. The server enforces endpoint
existence, uniqueness, self-edge rejection, and an acyclic dependency graph.
`todos.depends_on` remains only as a deprecated, transactionally synchronized
compatibility shadow for older clients and rollback. See [ADR 004](./adr/004-task-relationship-model.md).

## Deterministic Execution Insights

The server analyzes a revision-consistent Todo and normalized-relationship
snapshot to derive `ready`, `blocked`, blocker propagation, downstream impact,
critical path, deadline risk, and graph-health issues. These values are
read-only projections; they never introduce additional persisted lifecycle
states.

A project/root scope includes structural descendants plus recursive external
prerequisites. External tasks are marked as context and influence readiness
without inflating the project's summary counts. Missing estimates remain
explicitly unknown, and critical-path duration is exact only when every
relevant execution estimate is known. See
[ADR 006](./adr/006-deterministic-execution-graph-insights.md).

Graph presentation state is deliberately client-local. Web and Tauri store
node positions, viewport, and collapsed structural nodes per project/root scope
and Structure/Execution mode in LocalStorage. Resetting a layout removes only
that presentation snapshot; canonical tasks, relationships, and server-derived
execution insights are unchanged.

Project identity is server-owned and distinct from the compatibility root
Todo. Semantic task and relationship writes increment both the all-task graph
revision and every affected Project revision. Project-scoped insights and AI
plans compare the local revision, so activity in one project cannot stale a
proposal in another. See
[ADR 007](./adr/007-first-class-project-identity.md).

## Versioned AI Planning

AI planning captures the current graph revision and the hash of all prompt
context before presenting a proposal. The client applies that exact
`proposal_id` and `base_graph_revision`; the server rejects a stale preview
instead of rebasing it implicitly. One transaction creates the selected tasks
and relationships, updates the root, records forward/inverse operations, and
enqueues Vault reconciliation. Repeated identical requests replay the stored
result, while undo is refused after later graph or linked-data changes. See
[ADR 005](./adr/005-versioned-ai-plan-proposals.md).

## Unified Review and Project Artifacts

`review_items` is the cross-feature human approval queue. Plan proposals and
artifact revisions publish review subjects, but their own services remain the
authoritative state machines. Approving a plan invokes the same graph-revision
CAS and transactional apply used by the Task screen; approving an artifact
revision promotes an exact next version. Direct plan actions synchronize the
linked review in the same commit.

Artifacts hold the latest approved project brief, requirements, decision,
research note, report, or external output. Proposed content is stored in an
immutable version slot and cannot replace the current artifact until review.
See [ADR 008](./adr/008-unified-review-and-versioned-artifacts.md).

## Agent Execution Attempts

`AgentTask` describes an outcome while `AgentRun` records one execution attempt.
Runs persist provider/model identity, heartbeats, progress, result/error,
adoption, and an ordered event log. Built-in execution is registered by run ID
so cancel requests stop the live coroutine as well as changing durable state.
Successful top-level attempts enter the unified Review Inbox; only approval
adopts the result and completes the linked Todo. See
[ADR 009](./adr/009-agent-task-run-separation.md).

Every run transition also pushes a `run_state_changed` WebSocket event
(`run_id`, `agent_task_id`, `todo_id`, `conversation_id`, `title`, `status`,
`progress_message`, `result_summary`, `error`, `review_id`). Unlike
`module_data_changed`, which only asks clients to refetch, this is the
user-facing signal: the chat's delegation card, toasts, OS notifications, the
Runs nav badge and the Android notification all read from it, so a run that
stops in `waiting_input` or `waiting_review` reaches the user wherever they
are. `task_completed` carries `run_status` for the same reason -- a result
that still awaits review is never announced as finished. A review decision of
*changes requested* with a note resumes the run with that note as the
follow-up (`run_resume_service`); without a note, or when the provider is
unavailable, the run waits in `waiting_input` for a manual resume.

Every run also has a conversation thread. `create_run` reuses the delegating
chat or creates a project-scoped conversation for work started from the Inbox
(`run_thread_service.ensure_thread`), and the moments that need a person --
input requested, result ready for review, resumed, approved, rejected,
completed, failed, cancelled -- are written into it as `run_update` assistant
messages, once per run event. Review items, run cards and the task page link
to that thread first. See [ADR 019](./adr/019-agent-run-thread.md).

The thread is also where the user acts: the `run_update` card takes the
answer to a waiting run (`POST /runs/{id}/resume`) and the review decision
(`POST /reviews/{id}/decision`) inline while the run is still waiting, and
keeps the record afterwards. Built-in skills can ask instead of guessing: a
reply that starts with `NEEDS_INPUT:` (`agent_task_service.parse_needs_input`)
parks the run in `waiting_input` with the question; the follow-up resumes the
same attempt with the answer appended to its instruction, restarting the skill
chain from its first skill. Delegation works on both transports --
`Orchestrator.resolve_intent_response` creates and launches the run for the
SSE stream as well, so Android can delegate by chatting.

The chat also knows where the agent is. `build_conversation_context` appends
an `[Agent activity]` block -- active runs with what each needs, and the
count of results waiting for review, scoped to the thread's project or to
the thread's own run -- to every chat prompt, and the `query_runs` intent
answers "how is the research going?" from the same data. A scheduler
watchdog (`run_watchdog_service`, every `RUN_WATCHDOG_INTERVAL_SECONDS`)
fails a started run that nothing in this process is executing once its
heartbeat is older than `RUN_HEARTBEAT_TIMEOUT_MINUTES` -- a dead desktop
worker no longer leaves a run `running` forever -- and, once per wait, asks
again in the thread for a run left in `waiting_input` longer than
`RUN_INPUT_REMINDER_MINUTES`.

On the web the nav offers one place for all of this: the Attention page
(`/attention`) lists runs waiting for input, pending review items of every
subject type, and unsuccessful runs that still need a retry or a return to
the queue, each acted on in place through the shared `RunCard` and
`ReviewItemCard` and linked to its thread. The Runs log (`/runs`) and the
review history (`/review`) remain as the full record behind it.

### Paseo execution provider

Projects can select `paseo` as their default execution provider and bind a
repository path visible to the configured daemon. ClawChat invokes Paseo's
official JSON CLI contract without a shell: it creates a local or worktree
workspace, starts a background agent, persists the external workspace/agent
IDs, polls provider state into heartbeats, and forwards follow-up or stop
commands. The provider/model value remains a Paseo identifier such as
`codex/gpt-5.5`.

Paseo continues to own agent credentials, process supervision, worktrees, and
remote transport. ClawChat owns the AgentTask/AgentRun state machine, output
Artifact, ReviewItem, adoption, and linked Todo completion. Active Paseo runs
survive a ClawChat restart: startup skips built-in interruption reconciliation
for reattachable external IDs and launches fresh monitors. See
[ADR 010](./adr/010-paseo-execution-provider.md).
