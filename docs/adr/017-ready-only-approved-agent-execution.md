# ADR 017: Ready-only approved Agent execution

**Status:** Accepted  
**Date:** 2026-08-28

## Context

Skill assignment and Agent execution were previously combined in the Task
detail UI. A single Skill click could start work without showing its provider
or impact, and the delegation endpoint did not reject Blocked Tasks,
structural containers, or a second Run for the same Todo.

## Decision

Skill assignment and execution are separate actions. The Inbox Inspector is
the initial execution launcher because it already presents deterministic
Ready/Blocked context and Task-level Run telemetry.

An explicit execution request uses the existing delegation endpoint with
`require_ready=true` and `approved=true`. The server recomputes canonical graph
insights at request time and accepts only a pending, actionable leaf whose
dependencies are complete. The planning Skill is excluded because it has its
own proposal and approval lifecycle.

After provider and workspace validation, the server atomically changes the
Todo from `pending` to `in_progress`. Only the request that wins this
conditional update can create the Run. Existing active Runs are also checked
and reported with their Run identity.

The UI uses a two-step flow:

```text
Choose Skill and provider
        → Review one-Run impact
        → Explicit Start approval
        → Todo becomes In Progress
        → Result waits in Review
```

Legacy delegation callers remain compatible when `require_ready` is omitted.

## Consequences

- Blocked, completed, cancelled, in-progress, and container Tasks cannot enter
  the approved execution path.
- Concurrent approval requests have a single winner without adding a new
  database column or table.
- Skill buttons in Task detail only assign Skills; they do not implicitly run
  them.
- Provider errors and Paseo workspace requirements are resolved before the
  execution claim.
