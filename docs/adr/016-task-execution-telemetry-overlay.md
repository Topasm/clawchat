# ADR 016: Task execution telemetry overlay

**Status:** Accepted  
**Date:** 2026-08-28

## Context

The Inbox Project/Work Tree describes planning structure, while Agent Runs,
Review items, and Artifacts describe execution. Fetching the existing run list
and then one Artifact collection per Project would cap older results and create
an N+1 request pattern. Copying these values onto Todo rows would introduce a
second source of truth.

## Decision

Expose a sparse, read-only Task execution projection at
`GET /api/todos/execution-telemetry`. Each returned Task record contains its
latest Run status and progress, pending Review count, Artifact count, and
latest Artifact identity. The projection is calculated from canonical
`agent_runs`, `review_items`, `artifact_revisions`, and `artifacts` rows.

Project filtering follows the Task's current `project_id`; a historical Run's
stored Project does not override current Task ownership. The web query polls
only while a Run is queued, starting, or running, and is invalidated by Run,
Review, and Artifact WebSocket changes.

Inbox Tree nodes render this projection as compact overlays. Selecting a node
shows links to the canonical Runs, Review, and Project Artifact screens. Runs,
Reviews, and Artifacts remain outside the planning hierarchy.

## Consequences

- Tree telemetry requires one bounded aggregate request instead of per-Project
  Artifact requests.
- Todo persistence and graph revision semantics remain unchanged.
- Execution badges recover after reconnect and do not depend on local state.
- Additional clients can consume the same projection without reproducing join
  and precedence rules.
