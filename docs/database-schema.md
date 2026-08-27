# Database Schema

ClawChat uses a single SQLite database storing application data on the self-hosted server. SQLAlchemy models define current metadata, Alembic records versioned migrations, and a legacy idempotent startup path remains for deployed self-hosted/bundled databases (see [Migration Strategy](#migration-strategy)).

## Entity Relationship Overview

```
conversations       1──N messages
messages            N──1 conversations
todos               (standalone, linked via conversation_id)
todos               N──1 todos (self-ref via parent_id for sub-tasks)
todos               N──N todos (directed task_relationships)
task_graph_states    1──N plan_proposals (revision snapshot, logical link)
plan_proposals       1──0..1 change_sets
plan_proposals       N──1 todos (root_task_id, SET NULL)
change_sets          1──N vault_sync_jobs
attachments         N──1 todos (todo_id, CASCADE)
events              (standalone, linked via conversation_id)
agent_tasks         (standalone, linked via conversation_id)
paired_devices      (standalone)
pairing_sessions     (short-lived device pairing state)
refresh_sessions     (rotating refresh-token families)
host_identity        (desktop pairing/relay identity)
user_settings       (standalone)
```

All module tables (`todos`, `events`) link back to the `conversation_id` and `message_id` that created them, enabling full traceability.

---

## Tables

### `conversations`

Stores chat conversation metadata.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique conversation identifier |
| `title` | TEXT | NOT NULL, DEFAULT '' | Conversation title (auto-generated or user-set) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the conversation was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last activity timestamp (updated on new message) |
| `is_archived` | BOOLEAN | NOT NULL, DEFAULT FALSE | Whether the conversation is archived |
| `metadata` | JSON | NULLABLE | Optional metadata (e.g., pinned status, tags) |

### `messages`

Stores individual messages within conversations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique message identifier |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NOT NULL | Parent conversation |
| `role` | TEXT | NOT NULL, CHECK IN ('user', 'assistant', 'system') | Message sender role |
| `content` | TEXT | NOT NULL | Message text content |
| `message_type` | TEXT | NOT NULL, DEFAULT 'text' | Type: 'text', 'action_card', 'image', 'system' |
| `intent` | TEXT | NULLABLE | Classified intent (e.g., 'create_todo', 'query_calendar') |
| `metadata` | JSON | NULLABLE | Extra data (action card payload, intent params, etc.) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the message was sent |

### `todos`

Stores task/to-do items, created via conversation or direct API.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique todo identifier |
| `title` | TEXT | NOT NULL | Task title |
| `description` | TEXT | NULLABLE | Detailed task description |
| `status` | TEXT | NOT NULL, DEFAULT 'pending', CHECK | Canonical lifecycle: 'pending', 'in_progress', 'completed', 'cancelled' |
| `priority` | TEXT | NOT NULL, DEFAULT 'medium' | Priority: 'low', 'medium', 'high', 'urgent' |
| `due_date` | TIMESTAMP | NULLABLE | Task deadline |
| `completed_at` | TIMESTAMP | NULLABLE | When the task was completed |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that created this todo |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that created this todo |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last modification timestamp |
| `tags` | JSON | NULLABLE | Array of string tags for categorization |
| `parent_id` | TEXT (UUID) | FOREIGN KEY -> todos.id ON DELETE SET NULL, NULLABLE | Parent task ID for sub-task hierarchy |
| `sort_order` | INTEGER | NOT NULL, DEFAULT 0 | Manual ordering within kanban columns |
| `assignee` | TEXT | NULLABLE | Legacy agent persona or first skill ID, for backward compat |
| `enabled_skills` | JSON | NULLABLE | Array of skill IDs bound to this task (e.g. `["plan","research"]`) |
| `inbox_state` | TEXT | NOT NULL, DEFAULT 'none' | Pipeline state: `none`, `captured`, `classifying`, `questioning`, `planning`, `plan_ready`, or `error` |
| `estimated_minutes` | INTEGER | NULLABLE | AI-estimated time to complete |
| `automation_error` | TEXT | NULLABLE | Latest inbox/planning automation failure |
| `clarification_questions` | JSON | NULLABLE | Questions requested before planning |
| `clarification_answers` | JSON | NULLABLE | Answers keyed by question index |
| `source` | TEXT | NULLABLE | Origin such as Obsidian, chat, or API |
| `source_id` | TEXT | NULLABLE | Source-relative identity/path |
| `depends_on` | JSON | NULLABLE | Deprecated compatibility shadow of normalized `depends_on` relationships |
| `recurrence_rule` | TEXT | NULLABLE | iCal RRULE for recurring tasks |
| `recurrence_end` | TIMESTAMP | NULLABLE | Optional recurrence boundary |
| `recurrence_exceptions` | JSON | NULLABLE | Skipped recurrence dates |
| `recurring_source_id` | TEXT (UUID) | FOREIGN KEY -> todos.id ON DELETE SET NULL, NULLABLE | Original task in a recurring series |

### `task_relationships`

Stores normalized, directed links between tasks. Structural containment remains
in `todos.parent_id`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Relationship identifier |
| `source_task_id` | TEXT | FOREIGN KEY -> todos.id ON DELETE CASCADE, NOT NULL | Task that owns the outgoing relationship |
| `target_task_id` | TEXT | FOREIGN KEY -> todos.id ON DELETE CASCADE, NOT NULL | Referenced task; the prerequisite for `depends_on` |
| `type` | TEXT | NOT NULL, CHECK | `depends_on`, `related`, or `duplicate` |
| `label` | TEXT | NULLABLE | Optional user-facing relationship label |
| `created_by` | TEXT | NOT NULL | Provenance such as `user`, `migration`, or an AI planner |
| `proposal_id` | TEXT | NULLABLE | Versioned plan proposal provenance; retained across compatibility migration |
| `created_at` | TIMESTAMP | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL | Last modification timestamp |

The tuple `(source_task_id, target_task_id, type)` is unique and source cannot
equal target. The service validates both endpoints and rejects a `depends_on`
write that would introduce a cycle. SQLite insert/update triggers repeat the
cycle check atomically at the database boundary, closing concurrent-write
races. Existing JSON dependencies are validated and backfilled during upgrade;
the JSON column is synchronized temporarily so supported older clients and
downgrade retain dependency data.

### `data_migration_markers`

Stores durable completion markers for runtime data migrations. The
`normalized_task_relationships_v1` marker is committed in the same transaction
as legacy dependency import. If startup is interrupted, absence of the marker
causes a safe retry; after completion, normalized rows overwrite the JSON
compatibility shadow. A marker without its relationship table fails closed
instead of recreating an empty table and erasing legacy dependencies.

### `task_graph_states`

Stores the monotonic optimistic-concurrency revision for a task graph scope.
PR 3 uses a single `global` row; the scoped key leaves room for project-local
graphs later.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `scope_id` | TEXT | PRIMARY KEY | Graph scope; currently `global` |
| `revision` | INTEGER | NOT NULL, CHECK >= 0 | Monotonic semantic graph revision |
| `updated_at` | TIMESTAMP | NOT NULL | Last revision change |

SQLite triggers increment the global revision for semantic Todo changes and
task-relationship inserts, updates, and deletes. Pipeline-only fields such as
`inbox_state`, `automation_error`, and `updated_at` do not invalidate a plan.

### `plan_proposals`

Stores the exact, strictly validated model output and the graph snapshot on
which it was generated. A proposal is an immutable review artifact; user edits
are recorded in its change set when applied.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Proposal identifier |
| `root_task_id` | TEXT | FOREIGN KEY -> todos.id ON DELETE SET NULL, NULLABLE | Planned root task |
| `agent_task_id` | TEXT | UNIQUE, FOREIGN KEY -> agent_tasks.id ON DELETE SET NULL, NULLABLE | Generation run |
| `base_graph_revision` | INTEGER | NULLABLE, CHECK >= 0 | Preview revision; NULL only for imported legacy history |
| `model_provider`, `model_name` | TEXT | NULLABLE | AI provider/model audit metadata |
| `prompt_version` | TEXT | NULLABLE | Prompt/schema version |
| `context_hash` | TEXT | NULLABLE | Hash of canonical DB and external planning context |
| `payload_json` | JSON text | NULLABLE | Strict plan payload |
| `validation_json` | JSON text | NULLABLE | Deterministic validation result |
| `status` | TEXT | NOT NULL, CHECK | `generating`, `draft`, `applying`, `applied`, `rejected`, `stale`, `reverted`, or `failed` |
| `is_revertible` | BOOLEAN | NOT NULL | False for legacy/applied-and-reverted proposals |
| `created_at`, `updated_at` | TIMESTAMP | NOT NULL | Audit timestamps |
| `applied_at` | TIMESTAMP | NULLABLE | Successful apply time |

### `change_sets`

Stores one atomic proposal application, its canonical request hash, the exact
response, and inverse operations for conservative undo. `proposal_id` is
unique, making repeated identical apply requests replay-safe and rejecting a
second apply with different edits.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Change-set identifier |
| `proposal_id` | TEXT | UNIQUE, FOREIGN KEY -> plan_proposals.id ON DELETE RESTRICT | Applied proposal |
| `request_hash` | TEXT | NOT NULL | Canonical hash of proposal, revision, selection, and edits |
| `base_graph_revision` | INTEGER | NOT NULL, CHECK >= 0 | Preview revision claimed by apply |
| `applied_graph_revision` | INTEGER | NULLABLE, CHECK >= 0 | Revision after atomic apply |
| `reverted_graph_revision` | INTEGER | NULLABLE, CHECK >= 0 | Revision after undo |
| `operations_json` | JSON text | NOT NULL | Approved payload and forward operation audit |
| `inverse_operations_json` | JSON text | NOT NULL | Generated IDs and root snapshot used by undo |
| `response_json`, `undo_response_json` | JSON text | NULLABLE | Exact idempotent replay responses |
| `status` | TEXT | NOT NULL, CHECK | `applying`, `applied`, `reverted`, or `failed` |
| `created_at`, `updated_at` | TIMESTAMP | NOT NULL | Audit timestamps |
| `applied_at`, `reverted_at` | TIMESTAMP | NULLABLE | Lifecycle timestamps |

Undo succeeds only while the graph is still at `applied_graph_revision` and
the generated tasks have no later attachments, agent runs, conversations, or
nested plan proposals. This intentionally refuses ambiguous destructive undo.

### `vault_sync_jobs`

Transactional outbox for eventual Obsidian reconciliation. The job is committed
with the change set, then leased and processed after the database transaction;
the worker verifies that its canonical graph snapshot stayed current across the
filesystem write. Stale snapshots are refreshed, while filesystem failures or
continuous graph churn use retry/backoff and never roll back an already-applied
graph change.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Outbox job identifier |
| `change_set_id` | TEXT | FOREIGN KEY -> change_sets.id ON DELETE SET NULL, NULLABLE | Originating change set |
| `event_type` | TEXT | NOT NULL | Apply or revert reconciliation event |
| `aggregate_id` | TEXT | NOT NULL | Root task identifier |
| `payload_json` | JSON text | NOT NULL | Todo IDs and graph revision to reconcile |
| `dedupe_key` | TEXT | UNIQUE, NOT NULL | Idempotent delivery key |
| `status` | TEXT | NOT NULL, CHECK | `pending`, `processing`, `succeeded`, or `failed` |
| `attempts` | INTEGER | NOT NULL, CHECK >= 0 | Delivery attempts |
| `available_at`, `locked_at` | TIMESTAMP | Retry/lease timestamps | Delivery scheduling |
| `last_error` | TEXT | NULLABLE | Most recent delivery failure |
| `created_at`, `updated_at`, `completed_at` | TIMESTAMP | Audit timestamps | Job lifecycle |

### `events`

Stores calendar events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique event identifier |
| `title` | TEXT | NOT NULL | Event title |
| `description` | TEXT | NULLABLE | Event description or notes |
| `start_time` | TIMESTAMP | NOT NULL | Event start datetime |
| `end_time` | TIMESTAMP | NULLABLE | Event end datetime |
| `location` | TEXT | NULLABLE | Event location |
| `is_all_day` | BOOLEAN | NOT NULL, DEFAULT FALSE | Whether this is an all-day event |
| `reminder_minutes` | INTEGER | NULLABLE | Minutes before event to send reminder |
| `recurrence_rule` | TEXT | NULLABLE | iCal RRULE string for recurring events |
| `recurrence_end` | TIMESTAMP | NULLABLE | Optional recurrence boundary |
| `recurrence_exceptions` | JSON | NULLABLE | Skipped recurrence dates |
| `recurring_event_id` | TEXT (UUID) | FOREIGN KEY -> events.id, NULLABLE | Original event in a recurring series |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that created this event |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that created this event |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last modification timestamp |
| `tags` | JSON | NULLABLE | Array of string tags |

### `attachments`

Stores file attachments linked to todos.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique attachment identifier (`att_` prefix) |
| `filename` | VARCHAR(255) | NOT NULL | Original uploaded filename |
| `stored_filename` | VARCHAR(255) | NOT NULL | UUID-based filename on disk |
| `content_type` | VARCHAR(100) | NOT NULL | MIME type (e.g., `image/jpeg`) |
| `size_bytes` | BIGINT | NOT NULL | File size in bytes |
| `todo_id` | TEXT (UUID) | FOREIGN KEY -> todos.id ON DELETE CASCADE, NULLABLE | Linked todo |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Upload timestamp |

### `agent_tasks`

Stores asynchronous AI agent tasks (research, summarization, etc.).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique task identifier |
| `task_type` | TEXT | NOT NULL | Type: 'research', 'summarize', 'draft', 'custom' |
| `instruction` | TEXT | NOT NULL | User's original instruction for the agent |
| `status` | TEXT | NOT NULL, DEFAULT 'queued' | Status: 'queued', 'running', 'completed', 'failed' |
| `result` | TEXT | NULLABLE | Agent's output/result text |
| `error` | TEXT | NULLABLE | Error message if task failed |
| `agent_type` | TEXT | NOT NULL, DEFAULT 'general' | Legacy agent type or first skill ID |
| `skill_chain` | JSON | NULLABLE | Ordered array of skill IDs to execute (e.g. `["research","summarize"]`) |
| `current_skill_index` | INTEGER | NOT NULL, DEFAULT 0 | Index of currently executing skill in the chain |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that triggered this task |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that triggered this task |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the task was queued |
| `started_at` | TIMESTAMP | NULLABLE | When execution began |
| `completed_at` | TIMESTAMP | NULLABLE | When execution finished |

### Supporting persistence

- `paired_devices` and `pairing_sessions` store trusted device metadata and short-lived pairing claims.
- `refresh_sessions` stores hashed rotating refresh-token family state; raw tokens and JWT IDs are not persisted.
- `host_identity` stores the desktop host's persistent public/private key pair used for pairing and relay handshakes.
- `user_settings` stores per-user settings JSON.

---

## Indexes

```sql
-- Message lookup by conversation (most frequent query)
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Conversation ordering
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at);

-- Todo queries (by status, due date, hierarchy, ordering)
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_due_date ON todos(due_date);
CREATE INDEX idx_todos_conversation_id ON todos(conversation_id);
CREATE INDEX idx_todos_parent_id ON todos(parent_id);
CREATE INDEX idx_todos_sort_order ON todos(sort_order);
CREATE INDEX idx_todos_source ON todos(source);
CREATE INDEX idx_todos_recurrence_rule ON todos(recurrence_rule);

-- Event queries (by time range)
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_end_time ON events(end_time);
CREATE INDEX idx_events_conversation_id ON events(conversation_id);

-- Attachment lookup (by owner)
CREATE INDEX idx_attachments_todo_id ON attachments(todo_id);

-- Agent task status monitoring
CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX idx_agent_tasks_conversation_id ON agent_tasks(conversation_id);

-- Versioned planning and durable Vault delivery
CREATE INDEX idx_plan_proposals_root_status ON plan_proposals(root_task_id, status);
CREATE INDEX idx_plan_proposals_created_at ON plan_proposals(created_at);
CREATE INDEX idx_change_sets_status ON change_sets(status);
CREATE INDEX idx_vault_sync_jobs_delivery ON vault_sync_jobs(status, available_at);
CREATE INDEX idx_vault_sync_jobs_change_set_id ON vault_sync_jobs(change_set_id);
```

## Full-Text Search

SQLite's FTS5 extension enables full-text search across messages, todos, and events:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(id UNINDEXED, content);
CREATE VIRTUAL TABLE todos_fts USING fts5(id UNINDEXED, title, description);
CREATE VIRTUAL TABLE events_fts USING fts5(id UNINDEXED, title, description, location);
```

FTS tables are backfilled at startup and kept in sync with SQLite triggers.

---

## Migration Strategy

Alembic is the versioned migration source for new schema changes. The current
chain normalizes task status, migrates JSON dependencies into relationships,
then adds graph revisions, versioned plan proposals, change sets, and the Vault
outbox. Completed legacy `plan_todo` agent tasks are retained as non-actionable
proposal history rather than silently discarded.

```bash
# Run from server/ (or pass -c server/alembic.ini from the repository root)
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "describe the schema change"
uv run alembic check
```

`database.init_db()` still performs a legacy idempotent bootstrap for existing self-hosted and bundled installations. Keep this compatibility path aligned until deployed databases can be stamped safely at the Alembic baseline.

### How it works

On every server start, the compatibility path runs through these phases:

1. **`_ensure_data_dir()`** -- Creates the SQLite data directory and upload directory if they don't exist.
2. **`Base.metadata.create_all`** -- SQLAlchemy creates any tables that are missing (no-op for tables that already exist).
3. **`_apply_schema_corrections(session)`** -- Runs `ALTER TABLE ... ADD COLUMN` statements for columns that may be absent in older databases. Each statement is wrapped in a try/except that silently ignores "duplicate column" errors, making the entire list idempotent.
4. **`_run_data_migrations(session)`** -- One-time data transforms (e.g., back-filling a new column from legacy values). Each statement uses a `WHERE ... IS NULL` guard so it only applies once.
5. **`_setup_fts(session)`** -- Creates FTS5 virtual tables (`IF NOT EXISTS`), sync triggers (`IF NOT EXISTS`), and backfills any rows missing from the FTS indexes.

### Changing the schema

1. Add the column to the SQLAlchemy model in `server/models/`.
2. Generate and review an Alembic revision. Use batch operations for SQLite constraints or other table rebuilds.
3. If currently deployed legacy databases need the change before baseline stamping is available, mirror the minimal additive/backfill behavior in `database.py`.
4. Run `uv run alembic upgrade head`, `uv run alembic check`, and the relevant schema-correction/migration tests.

### Conventions

- Alembic revisions must preserve existing data and provide a downgrade when practical.
- Legacy startup corrections stay additive and idempotent; each `ALTER TABLE` is isolated so an already-present column does not block startup.
- Constraints and enum changes require an explicit migration decision, not only a Pydantic/model update.
- CI upgrades a fresh SQLite database and runs `alembic check`; `server/tests/test_schema_corrections.py` continues to verify compatibility bootstrap behavior.
