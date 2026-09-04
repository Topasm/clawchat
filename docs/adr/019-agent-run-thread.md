# ADR 019: Every agent run reports into a conversation thread

**Status:** Accepted
**Date:** 2026-09-04

## Context

Human–agent collaboration was split across four surfaces that only shared
IDs: Chat delegated work and went silent, the Inbox started runs that had no
conversation at all, the Runs page was the only place to answer a run waiting
for input, and the Review page the only place to approve a result. A run that
stopped in `waiting_input` produced no user-facing signal beyond a cache
invalidation, and the chat announced a result as "completed" while it still
waited for review. Reopening a conversation later showed only the original
"queued" message; what actually happened to the work was not in the record.

## Decision

Every `AgentRun` has a conversation. `create_run` reuses the delegating chat
when there is one and otherwise creates a project-scoped conversation titled
after the Todo (`run_thread_service.ensure_thread`), so runs started from the
Inbox are threads too. `AgentRunResponse.conversation_id` exposes it.

The moments that need a person are written into that conversation as ordinary
assistant messages with `message_type = "run_update"` and an `action_type:
"run_update"` metadata card: input requested, result ready for review,
resumed, approved, rejected, completed, failed, cancelled. Progress ticks are
not written; the live delegation card still shows them. Each message is keyed
on the run event sequence through the message idempotency index, so a
transition notified twice leaves one row. Sub-task runs report through their
parent and write nothing.

Every transition also pushes a `run_state_changed` WebSocket event carrying
the run's state, and a `conversation_updated` event with the new message id
that is deferred until the writing transaction commits. Review items, run
cards and the task page link to the thread first and to the run page second.

## Consequences

- A conversation reads as the record of the work: what was asked, what the
  agent needed, what was decided.
- Runs and Review remain as the log and the history, not as the only place a
  run can be acted on: the thread card takes answers and review decisions
  inline, and the Attention page (`/attention`) aggregates everything that
  has stopped for the user across both.
- Conversations created for Inbox-started runs appear in the project's chat
  list; they carry `metadata.origin = "agent_run"` for clients that want to
  group or hide them.
