# ADR 006: Deterministic execution graph insights

- Status: Accepted
- Date: 2026-08-27

## Context

Canonical task status and normalized dependency edges make the task graph
reliable, but they do not directly answer the execution questions a user has:

- What can I start now?
- Why is this task blocked?
- Which later tasks are affected?
- What is the longest remaining dependency path?
- Can the known work finish before its deadline?
- Is malformed legacy data making the graph unreliable?

These answers must remain stable across clients and must not depend on an LLM.
Calculating them independently in Web, Android, and agent prompts would create
another set of conflicting task states.

## Decision

The server derives execution insights from one revision-consistent snapshot of
`todos` and normalized `task_relationships`. The result includes the graph
revision used for the calculation. If a database isolation level can expose a
newer revision between reads, the service retries rather than labeling mixed
rows with one revision.

For `depends_on`, the stored edge remains:

```text
dependent task -> prerequisite task
```

Only `completed` satisfies a prerequisite. `cancelled` is terminal as a task
lifecycle value, but it remains a hard blocker for every dependent task.
`related` and `duplicate` edges do not affect execution analysis.

`Ready now` means a task is:

1. `pending`,
2. free of incomplete prerequisites, and
3. an actionable structural leaf rather than an inferred project container.

`in_progress` remains a separate running state. `blocked` and `ready` are
derived execution states and are never written into `todos.status`.

A root-scoped request starts with the root and its complete structural
descendant closure. It then includes the recursive prerequisite closure.
Prerequisites outside the project are returned with `scope_role = context` so
filtering a project cannot make a blocked task appear ready. Summary counts
for lifecycle and execution state cover the primary root scope rather than
inflating the project with context tasks. Critical-path uncertainty and graph
health still include relevant context because an external prerequisite can
block or invalidate the project forecast.

Critical path uses the active dependency DAG and `estimated_minutes` in
prerequisite-to-dependent topological order. Completed work contributes no
remaining duration. In-progress tasks conservatively retain their full
estimate because the data model has no remaining-work field. Structural
containers contribute no duration; a container used as an execution gate has
unknown completion time under the current model.

Missing or invalid estimates are never converted to zero. The canonical Todo
contract accepts any positive integer duration; a persisted zero or negative
legacy value is invalid. The API returns the known lower bound, the provisional
path, the unknown task IDs, and a nullable exact duration. Cycles, missing
prerequisites, cancelled prerequisites, or unknown container gates make
affected forecasts incomplete or unschedulable.

Deadline risk is a deterministic lower bound:

```text
earliest finish = calculated_at + longest remaining prerequisite path
slack minutes   = due_date - earliest finish
```

It assumes continuous wall-clock time, unlimited parallelism, and no resource
or calendar contention. A result can therefore prove that a known plan is too
long, but it is not a full scheduler. Missing estimates return
`unknown_estimate`; unschedulable dependency paths return `blocked`; past
deadlines return `overdue`.

Graph health detects dependency and parent cycles, missing references,
self/duplicate edges, cancelled prerequisites, invalid estimates, lifecycle
conflicts, and deadline ordering conflicts. Legitimate standalone tasks are
not called orphaned; isolated task counts are informational.

Persisted cycles are always health errors. For the current execution forecast,
completed nodes cut the runnable graph because they satisfy their dependents;
only an active-node cycle is unschedulable. A cancelled node is not such a cut:
it remains a hard blocker and makes its active downstream path unschedulable.

To keep snapshots bounded, transitive-blocker and downstream ID samples contain
at most 20 IDs per node. When the matching `*_truncated` flag is true, the
reported count is a lower bound rather than an exact total. The service rejects
scopes over the requested task or relationship limits instead of returning a
silently partial graph.

## Consequences

- Web and future clients consume one canonical execution analysis.
- Graph filters retain external blockers and cannot fabricate readiness.
- Critical-path and deadline values communicate uncertainty explicitly.
- The Graph UI can explain direct blockers, transitive blockers, and downstream
  impact without asking an LLM.
- Global graph revision changes may still invalidate unrelated projects until
  first-class projects provide project-local revisions.
- Date-only AI deadlines are currently stored as midnight timestamps. Accurate
  end-of-day and working-hours scheduling requires future timezone/all-day and
  availability models.
