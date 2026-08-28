# ADR 018: Agent Review to Ready handoff

**Status:** Accepted
**Date:** 2026-08-28

## Context

Ready-only execution moves one Task to `in_progress` and keeps its Agent result
behind the unified Review gate. Approval already adopted the Run and completed
the Task, but the Review UI could not explain which downstream Tasks would be
released. Failed, cancelled, and rejected Runs also left their Todo in
`in_progress` without an explicit path back to the execution queue.

## Decision

Agent Run review items expose a read-only `approval_impact` projection. It uses
the canonical project-scoped Graph Insights snapshot and identifies pending
leaf Tasks for which the reviewed Todo is the only remaining direct blocker.
Reading Review data never changes Todo state or the graph revision.

Approval is a compare-and-set transition on the Agent Run. Exactly one of
approve, reject, or request-changes may win a concurrent decision. A successful
approval returns the applied graph revision and the actual before/after set of
newly Ready Tasks:

```text
Review result
    -> approve once
    -> Todo completed
    -> graph revision advances
    -> downstream Ready Tasks returned
    -> user can open the next Task
```

Unsuccessful execution history is not rewritten. The explicit recovery command

```http
POST /api/runs/{run_id}/return-to-ready
```

changes only the linked Todo from `in_progress` to `pending`. It accepts only
the latest failed or cancelled Run, or a completed unadopted Run with a matching
rejected Review. It rejects adopted results, superseded attempts, Todo-wide
active Runs, and non-`in_progress` Tasks. The conditional update is the final
concurrency guard. Its response reports the derived Ready or Blocked state, so
the UI does not claim a Task is Ready when its dependencies changed meanwhile.

Retry follows the same latest-unsuccessful validation. An approved completed
Run can no longer silently reopen its Todo, and a Task returned to `pending`
must enter the normal Ready-only approval flow for a new execution.

## Consequences

- Review shows its execution impact before approval and the actual handoff
  after approval.
- Downstream Graph Insights refresh immediately instead of waiting for stale
  cache expiry.
- Failed execution remains durable audit history while Task lifecycle recovery
  stays explicit.
- Returning to the queue may produce `Blocked`, which is reported honestly.
- `AgentRunResponse.todo_status` lets clients hide stale Retry and recovery
  actions after another device changes the Todo.
