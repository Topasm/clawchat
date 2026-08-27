# ADR 015: AI-proposed Workstreams in Inbox triage

**Status:** Accepted  
**Date:** 2026-08-28

## Context

Revision-bound Inbox triage can place Tasks into existing branches, but forcing
every Task into the current Tree produces weak classifications when several
captured items form a coherent new workstream. Creating the branch before the
user approves the preview would violate the non-mutating proposal boundary.

## Decision

The triage function may return up to ten proposed Workstreams. Each proposal
has a preview-local key, an existing Project and optional existing parent,
title, description, confidence, and explanation. Task suggestions reference
the local key through `proposed_parent_key`; they never reference a fabricated
database ID.

The server validates that keys are unique and referenced, Projects and parents
exist, parents belong to the Project, and no existing or proposed sibling has
the same case-insensitive title. The preview remains read-only and tied to its
base graph revision.

The UI renders proposed Workstreams with a dashed outline. On approval it sends
only proposals referenced by selected Task suggestions as `create_parent`
destinations in the grouped placement command. The server creates each
container with `source=ai_triage_workstream`, moves its selected Tasks, and
records both operations in one placement change set.

Placement snapshots use `exists=false` for newly created containers. A
conservative Undo first restores moved Tasks and then deletes those containers.
It refuses to proceed if the graph revision or the created container's semantic
fields changed after apply. Older placement snapshots without `exists` remain
compatible and are treated as pre-existing Tasks.

## Consequences

- AI-proposed structure is visible but not persisted before approval.
- Selecting none of a proposal's Task suggestions means that Workstream is not
  created.
- Existing and proposed destinations can be applied and undone together.
- The explicit `todos.kind` domain model remains a separate migration; the
  current structural container is identified by source and child membership.
