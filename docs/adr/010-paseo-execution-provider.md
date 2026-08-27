# ADR 010: Paseo as an external execution provider

## Status

Accepted

## Context

ClawChat owns project context, dependency planning, AgentRun history, human
review, and completion. Reimplementing agent CLI discovery, PTY supervision,
worktree isolation, remote pairing, and multi-provider sessions would make the
core coding-specific and duplicate Paseo.

Paseo exposes an official JSON CLI over the same daemon API used by its apps.
The CLI supports local and remote targets, workspace creation, background agent
runs, inspection, follow-up messages, logs, and interruption.

## Decision

Add `paseo` as an AgentRun provider behind a Python adapter that invokes the
official CLI with argv arrays and JSON output. No prompt, repository path, or
title is evaluated by a shell. A configured offer URL is supplied through the
documented `PASEO_HOST` environment variable and is never persisted in an
AgentRun or returned by the health API.

Each project stores its default execution provider/model, repository path,
isolation mode, and optional base branch. A new Paseo attempt:

1. creates an explicit local or worktree workspace;
2. persists the returned workspace ID;
3. starts a background Paseo agent and persists its external ID;
4. maps inspected status, usage, and pending permissions into AgentRun state;
5. publishes the existing AgentRun ReviewItem;
6. on approval, writes the adopted transcript and provider metadata to a
   code-diff Artifact.

Cancellation first commits ClawChat's cancelled state and stops its local
monitor, then asks Paseo to interrupt the external agent. A failed external
stop is recorded as unconfirmed rather than rolling back the user's local
decision. Follow-up review requests reuse the same external agent. Retry creates
a new AgentRun attempt and isolated workspace.

On restart, built-in active runs fail safely as before. Active Paseo runs with
an external ID are retained and a fresh monitor reattaches. Transient daemon
failures are tolerated for the configured reconnect grace period.

## Consequences

- ClawChat stays provider-neutral while coding projects gain supervised agents.
- Paseo credentials, worktrees, relay, and process lifecycle remain outside the
  ClawChat database.
- The initial adapter polls the CLI rather than streaming the WebSocket SDK;
  progress is durable but less granular than Paseo's native timeline.
- Pending provider permissions are surfaced as `waiting_input` and must be
  resolved in Paseo before monitoring is resumed.
