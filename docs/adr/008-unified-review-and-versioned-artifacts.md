# ADR 008: Unified Review Inbox and Versioned Artifacts

- Status: Accepted
- Date: 2026-08-27

## Context

Plan proposals already require explicit approval, but future agent runs,
documents, diffs, scheduling changes, and sync conflicts would otherwise each
grow a separate review UI and lifecycle. Agent output also cannot remain only a
long result string if later tasks and conversations need to reuse it.

## Decision

`review_items` is the single human-review queue. It stores a polymorphic
subject reference, project scope, risk, decision, and note. Subject services
remain authoritative for the mutation: approving a `plan_proposal` calls the
existing revision-checked transactional apply, while approving an
`artifact_revision` promotes that exact revision to the artifact's current
version. A review decision never reimplements the subject command.

`artifacts` store the currently approved project output. Every accepted or
proposed value is retained in `artifact_revisions`; proposed revisions do not
change current content until approved. Only one pending/changes-requested
revision exists per artifact. A changes-requested revision can be edited and
resubmitted as the same version and review item.

Existing actionable and historical plan proposals are backfilled into the
review queue. Direct approval or dismissal from the task planning UI updates
the linked review item in the same database transaction.

## Consequences

- `/review` can answer “what needs me?” across project capabilities.
- Project overview counts pending reviews without interpreting proposal state.
- Artifacts provide durable, reusable outputs with fail-closed version
  promotion.
- Future AgentRun and provider adapters add subject handlers rather than new
  inboxes.
- Review items intentionally do not own mutation payloads; correctness remains
  in each subject's state machine.
