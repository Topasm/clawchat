# ADR 020: Orca as an external execution provider

## Status

Accepted

## Context

ClawChat bridged delegated runs to Paseo (ADR 010) and to OpenCode.
Orca (`stablyai/orca`, MIT) is an agent orchestrator in the same family as
Paseo. It runs Claude Code, Codex and other CLI agents in their own git
worktrees, keeps them alive in a long-running runtime, and ships a headless
build (`orca-server-linux-x64.tar.gz`, binary `orca-ide`) that needs no
desktop session.

Orca also has "Bots", which keep their own items, connectors and mobile app.
They overlap with ClawChat's own task, review and inbox flow, and Orca's store
is the source of truth for them. Bots are therefore not used. Orca is used
only as the place a run's agent executes.

A spike against `orca-ide` 1.4.267 established two surfaces:

- The CLI, with `--json`, for workspaces and chats: `repo add`,
  `worktree create`, `agent launch --surface chat`, `agent show` and
  `agent read`.
- The runtime's local socket for everything the CLI lacks. This covers the
  permission mode, sending a message, approvals, stopping a turn and the
  working-tree diff. The socket speaks newline-delimited JSON
  `{id, authToken, method, params}`, and its token sits in
  `orca-runtime.json`.
  - Writes carry an envelope with a sha256 fingerprint of the canonical
    payload.
  - This is Orca's internal protocol, not a published API.

## Decision

Add `orca` as an AgentRun provider. It sits behind `execution/orca_cli.py`,
which is the only code that knows either surface, and
`services/agents/orca_execution_service.py`. ClawChat never starts Orca. It
connects to the `orca-ide serve` the user runs on the same machine, so the
project's workspace host must be local, as for OpenCode.

A run:

1. Registers the project folder with Orca once. With worktree isolation, it
   creates `clawchat-<run>` on branch `clawchat/<slug>-<run>` from the
   project's base branch. With local isolation, it works in the folder itself.
2. Opens an idle chat with `ORCA_AGENT` (default `codex`). The model defaults
   to the CLI's cheap tier, `CODEX_CLI_MODEL` or `CLAUDE_CODE_MODEL`.
3. Persists the chat id before anything else. Orca outlives a ClawChat
   restart, so an executing run is reattached on startup, as Paseo runs are.
4. Sets the chat's permission mode, then sends the frozen instruction, which
   carries the skill text as for the other CLI backends.
   - A new Orca chat otherwise inherits `full-access` (no sandbox, no
     approvals).
   - Only `ask` and `auto` are accepted.
5. Polls the chat's state.
   - `blocked` with pending requests puts the run in `waiting_input`. The run
     card's Allow / Deny answers only the requests ClawChat showed, so one
     that appeared later is never approved unseen.
   - A follow-up instead of an answer declines the pending request and goes
     to the same chat.
   - The turn counts as finished only once the transcript's latest user
     message is the prompt ClawChat sent and the agent has replied after it.
6. On completion, reads the uncommitted changes through Orca's `git.status`
   and `git.diff`, renders one unified patch, and hands the run to review.
   Approval keeps the patch as a `code_diff` artifact.

Cancel stops the turn with `agentSession.cancel`, which also ends the command
the agent was running.

## Permission modes

| Mode | Codex sandbox | Escalations |
| --- | --- | --- |
| `auto` (default) | workspace-write | judged by Codex's own reviewer (`auto_review`) |
| `ask` | read-only | every one waits for the person in ClawChat |

`ask` cannot edit files: in testing, Codex reported the read-only filesystem
instead of asking to escalate an edit. So it suits read-only skills, and code
changes need `auto`. In `auto`, writes outside the worktree go to the agent's
reviewer, not to the person. This is weaker than OpenCode's bubblewrap
confinement and is the cost of using Orca's presets.

## Consequences

- Orca's socket protocol can change with any release, because Orca ships
  daily. All of it is isolated in one adapter, and its contract tests pin the
  fingerprints Orca accepted. Pin the Orca version you run.
- Orca writes into global config: hooks in `~/.claude/settings.json` and
  `~/.codex/hooks.json`, plus per-worktree trust in `~/.codex/config.toml`.
  `orca-ide agent hooks off` removes the hooks. Chats work without them.
- Worktrees and their branches stay after review, for the person to merge or
  delete, as with Paseo.
- Events are polled. Orca's push subscriptions need its streaming transport,
  which the local socket refuses.
- Paseo covered the same ground and was removed. Its settings, adapter and
  run-card branch are gone. The `paseo` value stays legal in the database:
  execution host kind and old runs keep it as history. Delegating from a
  project still set to `paseo` fails with `EXECUTION_PROVIDER_REMOVED` instead
  of quietly falling back to the built-in AI.
