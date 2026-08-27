# ADR 004: Normalized task relationships

- Status: Accepted
- Date: 2026-08-27

## Context

Execution prerequisites were historically stored as a JSON array in
`todos.depends_on`. That representation was sufficient for a read-only graph,
but it cannot enforce referential integrity, uniqueness, or acyclic execution
plans. It also makes relationship edits race with unrelated Todo updates.

## Decision

`task_relationships` is the source of truth for links between tasks. A row uses
one direction consistently:

```text
source_task_id = the task being executed
target_task_id = the task it refers to
type           = depends_on | related | duplicate
```

For a `depends_on` row, `target_task_id` is the prerequisite. The inverse
`blocks` relationship is derived at query time and is not stored as a second
edge. Structural containment remains `todos.parent_id`.

The server rejects self-links, missing endpoints, and duplicate
`(source_task_id, target_task_id, type)` tuples. Adding or changing a
`depends_on` edge also validates the complete dependency graph and rejects a
cycle. SQLite triggers enforce the same invariant atomically for concurrent
writes. Deleting either endpoint cascades to its relationships. Provenance
fields are server-owned and immutable through the public relationship API.
The named OpenAPI `TaskRelationshipType` enum generates the checked-in
TypeScript and Kotlin client contracts, so clients do not duplicate its wire
values manually.

Existing `todos.depends_on` values are validated and copied during migration.
The JSON column remains temporarily as a deprecated compatibility shadow for
older clients and safe rollback. All server relationship writes update that
shadow in the same transaction; new clients read and mutate only the normalized
API. A durable marker is committed atomically with runtime backfill so a crash
cannot turn a partially created table into the source of truth. Invalid legacy
graphs stop migration with an actionable error instead of silently losing an
edge. Downgrade reconstructs migrated legacy dependencies, but fails closed if
new relationship types or provenance/metadata would be lost.

## Consequences

- Graph and task-detail views observe the same server-owned relationships.
- Dangling, self-referential, duplicate, and cyclic execution edges cannot be
  introduced through supported writes.
- AI plan application must create relationship rows in the same transaction as
  its tasks.
- `related` and `duplicate` are available without overloading execution order.
- A later migration may remove the compatibility JSON column only after all
  supported clients no longer send `depends_on` in Todo payloads.
