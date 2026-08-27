# ADR 011: Atomic Inbox task placement

## Status

Accepted

## Context

Inbox capture and project planning used to be separate interactions. Placing a
captured task required independent updates to `project_id`, `parent_id`, and
`sort_order`. A partial failure could leave an invalid hierarchy, and a stale
client could overwrite a more recent Graph edit. Dragging also needs to move
the existing Task, not create a copy.

## Decision

Use one placement command for project classification, hierarchy moves, sibling
ordering, and returning a Task to Inbox:

```text
POST /api/todos/{todo_id}/placement
```

The command requires the client's global `expected_graph_revision`. The server
claims that revision, validates the Project and parent, rejects hierarchy
cycles, moves the complete subtree to the target Project, and renumbers the old
and new sibling groups in one transaction. The API represents a Project-root
drop with `parent_id` null; the server materializes it beneath the Project's
hidden compatibility root Todo so scoped Graph traversal remains complete.
Dropping on a Task sets that Task as the parent, and dropping on an insertion
line supplies `before_id`. Returning to Inbox clears Project and parent
placement and sets `inbox_state` to `captured`.

Placement and Inbox workflow are separate dimensions. Assigning a Project
clears a simple `captured` state, but preserves active clarification, planning,
and error states so a placed Task can remain visible in the appropriate Inbox
workflow section.

Each successful command stores the before and after snapshots in
`task_placement_changes`. The response includes the new graph revision,
affected Task IDs, a deterministic Ready/Blocked/critical-path delta when it
can be calculated, and a change-set ID. Undo is conservative:

```text
POST /api/todos/placements/{change_set_id}/undo
```

It succeeds only while the graph remains at the placement's applied revision
and every field changed by placement still matches the applied snapshot. This
prevents an old toast action or a later Inbox pipeline update from being
overwritten.

The desktop UI uses separate drop targets for Task containment and sibling
insertion. Touch clients use explicit Project/parent placement buttons. A Task
dependency is a different semantic operation and remains owned by
`task_relationships`; connector dragging is not part of placement.

## Consequences

- Inbox, Tree, List, Kanban, and Graph continue to reference one Task identity.
- Project, parent, order, and subtree scope changes commit or roll back together.
- Concurrent Graph edits fail with an explanatory revision conflict.
- Undo is safe but intentionally unavailable after any later semantic Graph
  change.
- Batch placement and dependency connectors can reuse the command/revision
  boundary without overloading the meaning of a card drag.
