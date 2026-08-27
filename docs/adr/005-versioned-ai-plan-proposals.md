# ADR 005: Versioned AI plan proposals

- Status: Accepted
- Date: 2026-08-27

## Context

AI planning previously stored the latest LLM payload only on an `AgentTask`.
Applying a plan did not identify the proposal that the user reviewed, so a
newer generation could be mixed with older user edits. Repeating an apply
created duplicate tasks, and a proposal could still be applied after the task
graph changed. The apply route also created an Obsidian project file before
the database transaction committed, which could truncate an existing user
document even when the database write later failed.

## Decision

`PlanProposal` is the source of truth for an AI planning suggestion.
`AgentTask` remains the execution record for the model call. Every actionable
proposal records the graph revision from which its context was built and has
an explicit lifecycle:

```text
draft -> applied -> reverted
  |         |
  |         +-> undo is allowed only while its change set is unchanged
  +-> rejected | stale
```

Until projects have their own persistent identity, the server maintains one
persisted `task_graph_state` row for the global task graph. SQLite triggers
increment its integer revision for semantic Todo changes and normalized task
relationship changes. Pipeline bookkeeping such as `inbox_state`,
`automation_error`, `updated_at`, and the deprecated `depends_on` JSON shadow
does not change the graph revision. This may reject a proposal after an
unrelated project's task changes, but it fails safely and can later be narrowed
to a project-scoped revision without changing the proposal contract.

Calendar and Vault inputs are part of the prompt but not the task graph. Their
canonical context hash is recomputed after model execution; if either the DB
planning context or external documents changed, the output is retained for
inspection with a `planning_context_changed` warning and marked stale.

Apply requests must include both the exact `proposal_id` and its
`base_graph_revision`. The server hashes a canonical representation of the
approved selection and edits. A single database transaction:

1. claims the graph revision and proposal,
2. validates the complete selected dependency graph,
3. creates tasks and normalized relationships,
4. updates the root task,
5. stores forward and inverse operations in a unique change set, and
6. enqueues any Vault reconciliation work.

The same proposal and approval hash returns the stored result, making retries
idempotent. The same proposal with different edits, or a changed base graph,
returns a conflict instead of creating a second result. Invalid dependencies,
cycles, dates, priorities, estimates, or references to excluded subtasks are
rejected rather than silently discarded.

Undo applies the stored inverse operations and is also idempotent. While graph
revision is global, undo is deliberately conservative: any graph change after
apply blocks automatic undo. This prevents cascade deletion of user-modified
children or newly attached graph data. Project folders and user documents are
never deleted by undo.

Vault synchronization is an at-least-once database outbox operation committed
with the change set. Filesystem reads and writes never occur inside the task
graph transaction. A worker reconciles ClawChat-owned markers against current
database state after commit, then verifies that the graph revision stayed
stable across the write. It refreshes and retries an older snapshot that races
with a newer graph update, and records persistent churn as a retryable failure.
Existing user
files are not created, truncated, or removed as a speculative part of apply.

Legacy completed planning `AgentTask` rows are retained as non-actionable
proposal history. They are stale unless existing relationships prove that they
were applied, and they are never assigned a fabricated current revision or an
inferred reversible change set.

## Consequences

- The proposal shown to a user is the proposal that is applied.
- Lost responses, repeated clicks, and safe client retries do not duplicate
  tasks or relationships.
- Stale plans fail with an explicit conflict and can be regenerated.
- Apply is atomic for database state, and Vault failure is observable and
  retryable without rolling back committed task data.
- A successful apply can be undone only while doing so cannot erase later
  work.
- Global revision conflicts are intentionally broader than necessary until a
  first-class project model enables project-scoped revisions.
