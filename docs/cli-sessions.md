# Existing Codex and Claude Code sessions

Open **Attention → CLI sessions** on web/desktop, or **Runs → CLI sessions** on
Android. The list refreshes every five seconds while the screen is open and shows
the provider, title, working directory, state, and available controls. Search by
title or directory. Enable **Show saved sessions** to include the most recent
100 saved Codex sessions. Loaded threads are included even outside that page.

Sessions belong to the OS account running the connected ClawChat server. A phone
connected to that host sees the host's sessions. A container or another computer
does not automatically see the desktop's CLI credentials or processes. Install
and log in to each CLI under the server account. Discovery checks `PATH` and the
desktop app's existing fallback locations, including `~/.local/bin`.
Set `CLI_SESSIONS_ENABLED=false` to disable discovery and controls on a host.
All `/api/cli-sessions` routes require the existing ClawChat authentication.

| Provider/session | Available here |
| --- | --- |
| Codex, loaded in the shared local daemon | Read conversation, send a follow-up, interrupt an active turn |
| Codex, saved history or unreachable daemon | Read saved conversation, copy the resume command; live status is unknown |
| Claude Code background session | Inspect recent output, stop; restart a stopped or failed session |
| Claude Code foreground terminal session | Inspect state/directory and copy the resume command; use its original terminal for live input |

Codex connects to `$CODEX_HOME/app-server-control/app-server-control.sock`
(default `~/.codex`). This must be a reachable WebSocket app-server socket.
Set `CLI_SESSIONS_CODEX_SOCKET` when the existing daemon uses another socket path.
History fallback starts a short-lived `codex app-server --stdio` only for reads;
it never resumes a thread or sends a control request to that separate process.
If the shared daemon cannot be reached, its sessions are not labelled running.
Restore the shared daemon connection before using live controls. The app does not
restart the daemon automatically, since that could interrupt existing work.

Claude discovery uses `claude agents --json --all`. Background control uses the
returned short job ID with `claude logs`, `claude stop`, or `claude respawn`.
Foreground sessions have a conversation ID but no background job ID; they do not
get unsupported stop/restart buttons. No process IDs are killed and no terminal
keystrokes are injected. Viewing or refreshing the list does not send prompts.

Each action rechecks the selected session. Codex steering includes the active
turn ID so an old click cannot steer a different turn. Automatic action retries
are disabled; after an uncertain response, refresh before sending another action.
External CLI sessions are not imported as AgentRuns and cannot complete a Todo
or bypass its review workflow.

Protocol references: [Codex App Server](https://developers.openai.com/codex/app-server/)
and [Claude Code agent view](https://code.claude.com/docs/en/agent-view).
