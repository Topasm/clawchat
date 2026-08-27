# ADR 012: Previewed Inbox dependency connectors

**Status:** Accepted  
**Date:** 2026-08-28

## Context

Inbox placement answers where a Task belongs. A dependency answers which Task
must finish first. Reusing the card-placement gesture for both operations makes
the resulting graph change ambiguous and can silently change Ready/Blocked
state or the critical path.

## Decision

Placement and dependency dragging use separate transfer types. Dragging a Task
card moves its Project, parent, or sibling order. Dragging its `↝` connector
makes that Task the dependent; dropping on another Task's connector makes the
drop target the prerequisite. The persisted direction remains:

```text
source_task_id = dependent task
target_task_id = prerequisite task
```

Touch and keyboard clients use an equivalent `Must wait for` selector. Both
inputs use semantic request names so callers do not have to infer storage
direction.

The UI does not create the edge immediately. It first sends a revision-bound
preview command:

```text
POST /api/task-relationships/commands/dependency/preview
POST /api/task-relationships/commands/dependency
```

The preview validates endpoints, uniqueness, and DAG safety inside a rolled-back
savepoint. It returns affected Task IDs and deterministic Ready, Blocked, and
critical-path deltas without changing relationships, the legacy compatibility
shadow, or graph revision. Apply repeats validation under the same global graph
revision claim and commits atomically. A stale revision returns HTTP 409.

Cycle failures include the existing path and complete cycle Task IDs so clients
can explain the rejected connection instead of ignoring the drop.

## Consequences

- Containment and execution-order gestures cannot be confused.
- Users see graph impact before committing a dependency.
- Preview and apply share canonical relationship validation and graph-insight
  algorithms.
- Concurrent changes fail closed and prompt a refreshed preview.
- A dependency preview is advisory; apply always validates again.
