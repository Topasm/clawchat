# ADR 007: First-class project identity and scoped graph revisions

- Status: Accepted
- Date: 2026-08-27

## Context

ClawChat historically inferred a project from a root Todo that had children, a
linked conversation, or an external source. That made the root Todo carry two
different meanings: a durable goal/context container and a completable unit of
work. It also left every AI plan on one global graph revision, so an unrelated
task edit could stale a project proposal or prevent its conservative undo.

## Decision

`projects` owns durable identity and project-level context. A Project has a
title, goal, description, lifecycle, deadline, compatibility root task,
default execution provider, and monotonic graph revision. Todos,
conversations, events, and plan proposals may reference `project_id`.

Project and Task have different semantics:

```text
Project = durable goal, context, policy, and workspace
Task    = completable execution unit in that workspace
```

New projects still create a root Todo as a compatibility graph container.
Existing APIs, task hierarchy, planning, Obsidian links, and old clients can
therefore continue to address the root task while new APIs use the Project ID.
The two IDs are never interchangeable.

Legacy root Todos are promoted idempotently when they have descendants, a
project conversation, or an explicit source. The root and its structural
descendants receive the new Project ID. Linked conversations, events, and plan
proposals are backfilled without changing their existing IDs.

Every semantic Todo or task-relationship mutation still increments the global
revision because the global graph includes all projects. It additionally
increments each affected Project revision. Project-scoped plan generation,
apply, undo, and graph insights compare the Project revision; unscoped work
continues to use the global revision.

Cross-project relationships remain representable. A mutation to such an edge
increments both affected Project revisions because both execution graphs can
change.

## Consequences

- Unrelated project edits no longer stale a proposal or block undo.
- Project chat, calendar entries, future artifacts, review items, and agent
  runs have a stable owner independent of the task tree.
- The compatibility root remains visible in Task APIs but is excluded from
  Project Overview task totals.
- Deleting a root task does not delete Project identity; the root reference is
  set to null. Product flows archive Projects rather than hard-delete them.
- Review, Artifact, and AgentRun models can use `project_id` without encoding
  project ownership through a special Todo.
