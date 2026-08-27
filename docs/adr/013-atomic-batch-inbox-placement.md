# ADR 013: Atomic batch Inbox placement

**Status:** Accepted  
**Date:** 2026-08-28

## Context

Moving captured Tasks one at a time makes Inbox triage expensive once the queue
contains more than a few related items. Calling the single-placement endpoint
repeatedly is not equivalent to one batch operation: a partial failure can leave
the Tree half-updated, every call uses a different graph revision, and Undo must
be repeated in reverse order.

## Decision

The Inbox supports an ordered multi-selection and sends one command:

```text
POST /api/todos/placements/batch
```

The request contains one to 100 unique `todo_ids`, a common Project/parent
destination, optional sibling insertion target, Inbox state, and expected graph
revision. The supplied ID order is the insertion order.

The server claims the revision once, validates every selected Task and subtree,
then updates Project, parent, sibling order, and Inbox state in one transaction.
Selecting both an ancestor and its descendant is rejected because their move
sets overlap. Project roots, missing Tasks, invalid parents, parent cycles, and
stale revisions fail the entire command.

One `task_placement_changes` row stores the complete before/after snapshot for
all moved subtrees and affected sibling scopes. The existing conservative Undo
endpoint restores the whole batch only if no later semantic Graph change or
placement-field edit has occurred.

## Consequences

- A batch is never partially placed.
- Dragging any selected card moves the visible selection in queue order.
- One toast Undo restores every Task in the batch.
- Ready/Blocked/critical-path deltas describe the completed batch, not each
  intermediate move.
- Batch AI triage proposals can reuse the same command boundary after preview
  and approval are added.
