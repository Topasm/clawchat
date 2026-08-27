# ADR 014: Revision-bound AI Inbox triage preview

**Status:** Accepted  
**Date:** 2026-08-28

## Context

Inbox placement is safe but still manual when captured Tasks belong to several
different Project branches. Applying AI recommendations one destination at a
time would make the second request stale after the first advances the graph
revision, and a partial failure would leave only some recommendations applied.

## Decision

AI triage is a non-mutating, revision-bound preview:

```text
POST /api/todos/placements/triage-preview
```

The client sends up to 50 unique Task IDs and the current global graph revision.
The service supplies only active/planned Projects and their existing non-root
Tree nodes to the configured AI provider. The function result is strictly
validated: Task and destination IDs must exist, each Task can appear at most
once, confidence is bounded, and a parent must belong to the proposed Project.
Uncertain Tasks are explicitly returned as unassigned. No fallback placement is
invented when model output is malformed.

The user selects recommendations in the preview and applies them through:

```text
POST /api/todos/placements/groups
```

This command accepts up to 20 destinations, applies every selected Task in one
database transaction, and emits one aggregate placement change set. All groups
roll back if any destination fails. The resulting toast has one conservative
Undo action for the complete recommendation set.

Both generation and apply compare against the preview's base graph revision.
A graph change during generation or before apply makes the preview stale.

## Consequences

- AI never moves Inbox Tasks without explicit approval.
- Recommendations can target several Projects and parents atomically.
- Existing placement, revision, insight-delta, and Undo semantics are reused.
- The first version recommends only existing locations; proposed Workstream
  creation remains a separate versioned change-set feature.
