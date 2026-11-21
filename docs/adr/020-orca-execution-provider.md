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
`services/agents/orca_execution_service.py`. Orca runs on the server's own
machine, so the project's workspace host must be local, as for OpenCode. By
default ClawChat starts and supervises that Orca itself (see "ClawChat's own
runtime" below). With `ORCA_MANAGE_RUNTIME=false` it connects to an
`orca-ide serve` the user runs and changes nothing in that profile.

A run:

1. Registers the project folder with Orca once. With worktree isolation, it
   creates `clawchat-<run>` on branch `clawchat/<slug>-<run>` from the
   project's base branch. With local isolation, it works in the folder itself.
2. Opens an idle chat with `ORCA_AGENT` (default `codex`). The model defaults
   to the CLI's cheap tier, `CODEX_CLI_MODEL` or `CLAUDE_CODE_MODEL`.
3. Persists the chat id before anything else. An executing run is
   reattached on startup. That only helps when Orca outlived the restart,
   which is the case for an Orca the user runs. Orca keeps no chats across a
   restart of its own, so with ClawChat's runtime a run that was executing
   fails with "Orca no longer has chat …" (see below).
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

## ClawChat's own runtime

With `ORCA_MANAGE_RUNTIME` (default on), `execution/orca_runtime.py`
supervises one `orca-ide serve --port <free> --bind 127.0.0.1 --no-pairing`.
It runs in a profile private to ClawChat: `ORCA_USER_DATA_PATH`, by default
`orca` next to the server's uploads folder. `ORCA_TELEMETRY_DISABLED=1` and
`DO_NOT_TRACK=1` are set.

- **Ready** means Orca wrote a new `orca-runtime.json` (new `runtimeId`) and
  its unix socket accepts connections. Orca leaves the file behind when it
  stops, so its presence proves nothing.
- **Restart.** A runtime that exits is started again after 1 s, 2 s, 4 s and
  so on, up to 60 s. A runtime that stayed up for a minute resets the delay.
  The status carries the reason, read from what Orca printed. One example is
  `Orca serve exited via SIGKILL.`.
- **Shutdown** stops the `serve` process group. It also stops its `orcad`
  child if that still answers on its socket. A pid from a stale file is never
  signalled.
- **Reuse.** If a runtime already answers for the profile, no second one is
  started. In 1.4.267, `serve` refuses a taken profile with exit code 78 and
  `OrcadInstanceLockError`, although its help names code 3.
  - A runtime ClawChat started is recorded in `clawchat-runtime.json` with
    its `runtimeId`. If the server was killed before it could stop Orca, the
    next start takes that runtime back and stops it on shutdown as usual.
  - Anyone else's runtime is used and left running. When it goes away,
    ClawChat starts its own.
- **Status.** The provider status reports `managed: true` and
  `runtime_state`: `starting`, `running`, `reused`, `restarting`, `failed` or
  `stopped`. Its `error` says why Orca is down, for example "ClawChat's Orca
  is not running: Orca exited with code 1: Orca serve exited via SIGKILL.".

### What it keeps out of the user's home

The spike found Orca writing global config. Against `orca-ide` 1.4.267 and
`codex` 0.171, with a scratch `HOME` and then the real one:

| Write | Kept out? | How |
| --- | --- | --- |
| Agent status hooks: `~/.claude/settings.json`, `~/.claude/keybindings.json`, `~/.claude/orca-agent-view.json`, `~/.codex/hooks.json`, hook trust in `~/.codex/config.toml`, `~/.orca/agent-hooks/*.sh` | Yes | `orca-ide agent hooks off --json` before Orca first serves the profile |
| Worktrees in `~/orca/workspaces/<repo>/<name>` | Yes | Each repository gets `worktreeBasePath = <profile>/workspaces` |
| Orca's per-worktree trust in `~/.codex/config.toml` (and Claude's in `~/.claude.json`) | Yes | Each repository gets `agentWorkspaceTrust = agent-asks` |
| Codex's own trust for the repository root in `~/.codex/config.toml` | No | Written by Codex, see below |
| Daemon sockets in `/tmp/.orca-daemon-<uid>` | No | Shared by every Orca on the machine |

- **Hooks.** A first `serve` with hooks on writes them all within two
  seconds. `agent hooks off` on a profile that already served removes the
  entries but leaves `"hooks": {}` stubs. It also creates
  `~/.cursor/hooks.json`, `~/.gemini/settings.json`,
  `~/.gemini/config/hooks.json`, `~/.factory/settings.json` and
  `~/.commandcode/settings.json` for agents that may not even be installed.
  So the supervisor asks `agent hooks status` and runs `off` before Orca has
  ever served the profile. Both work without a runtime. Both run with `HOME`
  pointed at `<profile>/clawchat-scratch-home`: the setting lands in the
  profile, and the stubs land in the scratch folder. Orca is not started
  until it confirms the hooks are off.
- **Worktrees and Orca's trust.** The worktree root is Orca's
  `workspaceDir` setting. It is stored in the profile's SQLite state and has
  no CLI flag or environment variable, and `settings.update` does not accept
  it. A repository's own `worktreeBasePath` overrides it, and so does its
  `agentWorkspaceTrust` decision. The socket's `repo.update` sets both. So
  `ensure_repo` sends `repo.update` for every repository in ClawChat's
  profile. If Orca refuses, the run fails with `ORCA_REPO_NOT_PRIVATE`
  rather than writing into the home folder. With `agent-asks`, Codex still
  ran and edited files in an `auto` chat.
- **What cannot be kept out.** Codex's app-server itself records the
  repository root as trusted when a thread starts with the `workspace-write`
  sandbox, which is Orca's `auto`. The entry is
  `[projects."<repo root>"] trust_level = "trusted"`. This was reproduced
  with `codex app-server` alone, without Orca. The key is the main checkout,
  not the worktree, so there is one entry per project. It stays after the
  run, as it does when the person runs Codex there. `ask` (`read-only`)
  writes none. Avoiding it would need a separate `CODEX_HOME` for runs,
  which would also separate the person's Codex login, settings and history,
  so it is not done. Codex likewise keeps its session history and memory
  under `~/.codex`, as for any Codex use.
- **Restarts lose chats.** Orca does not restore a chat after its runtime
  restarts. A run that was executing when ClawChat's Orca crashed, or when
  the server restarted, therefore fails with "Orca no longer has chat …".
  Its worktree is removed and its patch kept, like any failed run. Retrying
  starts it fresh.

`ORCA_MANAGE_RUNTIME=false` restores the earlier arrangement. ClawChat then
runs neither `agent hooks off` nor `repo.update`, so that profile's own
settings, including hooks and worktree location, are the user's.

## After review: landing the branch

Approving a worktree run commits its changes on the run's branch
(`changes_committed`); commits the agent made itself count as well. A run
with local isolation worked in the project folder itself, which ClawChat
never commits to or deletes.

An approved branch then lands from the run card, through
`POST /api/runs/{id}/land` (`services/agents/orca_landing_service.py`):

- **Merge** goes into the base branch the run was cut from. That is the
  project's base branch, or the branch checked out in the project folder when
  the worktree was made, recorded as `base_branch` with `repo_path`.
  - `git merge-tree --write-tree` computes the result before anything moves.
    The result is a fast-forward when the base has not moved, otherwise a merge
    commit made with `commit-tree`.
  - A conflict refuses the merge and names the files (`merge_conflict`, 409
    with `details.conflicts`). Both branches and every checkout stay as they
    were.
  - Where the base is checked out, it moves with `git merge --ff-only` to the
    computed commit. That checkout follows, and git refuses, moving nothing,
    rather than overwrite uncommitted edits or a base that moved meanwhile.
    Where nobody has the base checked out, a compare-and-swap `update-ref`
    moves it.
  - After a merge, Orca removes the worktree and deletes the branch
    (`branch_merged`, then `workspace_removed`). If Orca cannot do that now,
    the merge still stands, `workspace_cleanup_failed` says so, and the next
    Orca run retries the removal (`cleanup_pending`).
  - Merging never pushes.
  - It needs git 2.38 or newer.
- **Open PR** is offered when the project has a GitHub remote (origin first)
  and `gh` is on the server's PATH.
  - It pushes only the run's branch, then runs
    `gh pr create --repo <owner/name> --base <base> --head <branch>`. The title
    is the task's title, and the body is the run's result with the run id.
  - The worktree and branch stay, because the PR needs them (`pr_opened`, or
    `pr_failed` with gh's error).
  - git and gh run with prompts disabled, so a missing credential fails
    instead of hanging.

The latest outcome is kept in the run's metadata under `landing` and served
as `AgentRunResponse.landing`. Its state is `ready`, `merged`, `pr_opened`,
`conflict` or `failed`, with `can_open_pr`, the merge commit, the PR URL and
the conflicting files. The GitHub remote is looked up once, at approval, so
listing runs runs no git command.

The run card shows one primary button. On a GitHub repository that button is
"Open PR", with "Merge into ‹base›" beside it, because a local merge there
leaves the base ahead of origin until someone pushes. Elsewhere "Merge into
‹base›" is the primary button. The outcome shows in words on the card and in
the run's event log; Android shows the same events.

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
- An Orca the user runs (`ORCA_MANAGE_RUNTIME=false`) writes into global
  config: hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`, plus
  per-worktree trust in `~/.codex/config.toml`. ClawChat's own runtime keeps
  all of that out, except the Codex trust entry described above. Chats work
  without the hooks.
- An approved worktree is committed on its `clawchat/...` branch, which the
  run card then merges or sends as a pull request (see "After review"). A
  merged branch's worktree is removed. A branch sent as a PR, or never landed,
  stays until the person merges or deletes it. A worktree whose work will
  never be adopted is removed together with its branch: the review rejected
  it, or the run failed or was cancelled. Those runs cannot be resumed, and a
  retry starts a new run in a new worktree. What it changed is kept on the
  run as its patch first. When Orca cannot remove a worktree at that moment
  (after a merge as well), the run is marked `cleanup_pending`, and the next
  run that creates a worktree retries it. The same sweep removes the worktree
  of a run the watchdog failed after its monitor was gone. A project folder
  used with local isolation is never committed or removed.
- Merging writes to the person's repository: it moves the base branch and
  the checkout that has it. It does so only after `merge-tree` reports a clean
  result, and only through git's own fast-forward or compare-and-swap.
- Events are polled. Orca's push subscriptions need its streaming transport,
  which the local socket refuses.
- Paseo covered the same ground and was removed. Its settings, adapter and
  run-card branch are gone. The `paseo` value stays legal in the database:
  execution host kind and old runs keep it as history. Delegating from a
  project still set to `paseo` fails with `EXECUTION_PROVIDER_REMOVED` instead
  of quietly falling back to the built-in AI.
