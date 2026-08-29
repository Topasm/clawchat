# ADR 009: Separate Agent Tasks from Execution Runs

- Status: Accepted
- Date: 2026-08-28

## Context

`AgentTask` previously mixed the requested outcome with one mutable execution
status and result. Retrying overwrote evidence, cancellation changed a string
without stopping the process, and a restart could leave a run permanently
marked active.

## Decision

`AgentTask` remains the durable statement of what should be achieved.
`AgentRun` records each provider attempt with a monotonic attempt number,
instruction snapshot, provider/model, lifecycle, heartbeat, result, error, and
adoption state. `AgentRunEvent` is an append-only ordered progress log.

The canonical run lifecycle is:

```text
queued → starting → running → waiting_review → completed
                         ↘ waiting_input → running
                         ↘ failed | cancelled
```

Built-in executions are registered by run ID in an in-process task registry.
Cancellation first persists `cancelled`, then cancels the actual asyncio task.
Progress checkpoints refresh persisted state so a concurrent cancellation
cannot be overwritten by completion. Runs active when the server restarts are
marked interrupted/failed and remain retryable instead of appearing alive.

A successful top-level run publishes an `agent_run` ReviewItem. Approval
adopts that exact attempt and completes its linked Todo. Changes requested
pause it in `waiting_input`; a follow-up resumes the same attempt. Retry creates
a new attempt and preserves prior results.

## Consequences

- Failures, retries, provider/model changes, and result selection are auditable.
- `/runs` can display global or project-scoped execution state and event logs.
- Actual built-in cancellation works while the process is alive.
- External provider adapters can use heartbeat and controlled transition APIs.
  This half is unrealised as of 2026-08-29: `POST /runs/{id}/heartbeat` and
  `POST /runs/{id}/transition` exist but have no caller. The bundled Paseo
  adapter runs in-process and sets `run.heartbeat_at` through the ORM instead,
  and both routes sit behind the user's PIN-issued JWT, which an out-of-process
  runner has no way to hold. Wiring up a real external runner therefore needs a
  scoped credential for it first — the routes alone are not sufficient.
- Process resumption across hosts still requires a provider-specific adapter;
  the built-in provider safely fails interrupted work for explicit retry.
