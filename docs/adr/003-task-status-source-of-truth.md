# ADR 003: Server-owned task status

- Status: Accepted
- Date: 2026-08-27

## Context

The server historically persisted only `pending` and `completed`, while the React kanban stored `in_progress` in Zustand as a local override. That made graph, list, Android, and another device observe different task states and lost progress after local-state reset.

## Decision

`todos.status` is the only task lifecycle source of truth:

```text
pending | in_progress | completed | cancelled
```

Every API request, response, and status filter uses the FastAPI `TaskStatus` enum. SQLite has a matching check constraint and legacy unknown values migrate to `pending`. React server-state caches and Android's typed model preserve the server value directly; neither client may maintain a competing status override.

`blocked` is deliberately excluded. It answers whether a task can start and will be derived from incomplete dependency edges; lifecycle status answers how far the user has progressed.

FastAPI's OpenAPI document is checked in deterministically. TypeScript and Kotlin `TaskStatus` contracts are generated from its named `TaskStatus` component, and CI fails when the server snapshot or either generated artifact drifts.

## Consequences

- `in_progress` and `cancelled` survive restart, refetch, and cross-device access.
- Kanban, list, graph, web/Tauri, and Android consume the same persisted state.
- Adding or renaming a lifecycle state requires a server enum change, migration decision, OpenAPI regeneration, and client behavior review.
- Dependency normalization and computed blocked/readiness semantics remain separate work.
