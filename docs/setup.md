# Setup guide

How to set up the pieces of ClawChat that the [README](../README.md) only names:
agent tools, your own skills, calendar accounts, the Android app's two modes, and the
`make` targets.

## Agent tools: web search and MCP servers

```bash
docker compose --profile search up -d
```

This starts a private [SearXNG](https://docs.searxng.org) instance with JSON output enabled
(`searxng/settings.yml`). In **Settings → Agent tools**, set the web search address to
`http://searxng:8080` when ClawChat also runs in Docker, or `http://localhost:8888` otherwise,
and press **Test**. The Research skill can then search the web; results cite their URLs.

The same settings section adds **MCP servers** (a command to start, or a URL). Their tools are
offered to every skill unless the skill's `SKILL.md` lists `mcp-servers` under `metadata` (server
names or `server__tool` names, `none` for no tools). A server set to *Ask before each call* pauses
the run in Attention until you allow or deny that call; every call is recorded on the run.

Chat can use these tools too: web search and servers set to *Run without asking* answer questions
directly in a conversation (the reply shows which tool it is using). Servers that ask before each
call stay with delegated work, where the run can wait for your decision.

Your own skills go in `SKILLS_DIR` (default `data/skills`), one `<name>/SKILL.md` per directory in
the same [Agent Skills](https://agentskills.io) format as the built-ins. A skill named like a
built-in replaces it, and OpenCode runs see the directory as well.

## Calendar sync (CalDAV)

In **Settings → Calendar sync**, connect iCloud, Fastmail, Nextcloud, or any CalDAV server with
an app-specific password. Checked calendars show in Schedule and count as busy time when ClawChat
looks for free slots; their events are read-only in ClawChat. Pick one calendar under **Save
ClawChat events to** and events you create in ClawChat are written there, and edits or deletions
made to them in another app come back. When both sides changed the same event, the later change
wins.

Google Calendar is read through its **Secret address in iCal format** (Google Calendar → Settings →
the calendar → Integrate calendar). Paste it under **Google Calendar**: ClawChat keeps it encrypted
(key in `CALENDAR_KEY_FILE`, by default beside `UPLOAD_DIR`), shows only its host, and reads it every
15 minutes. Writing to Google needs OAuth and is not supported yet.

## Suggestions from the calendar

After each sync ClawChat reads the next two weeks of imported events by title and suggests the work
they call for: a study task the day before an exam, a task on a deadline's day, slides two days
before a talk, a progress note the day before a meeting, minutes after a meeting ends, a weekly
class's project, and a free stretch of working hours for a task with a deadline. Exams and deadlines
are added right away (turn that off in Calendar sync); everything else waits on Today behind one line,
"Suggestions N", with one button per row. Anything added can be undone, a dismissed suggestion does
not come back, and an event turned down twice gets no more. Holiday and birthday calendars are left
out, and any calendar can opt out.

## Android: local or connected

On first launch, choose **Use on this device** for a compact offline todo,
calendar, search, reminder, share-capture, and widget experience backed only by
the phone's Room database. Choose **Connect a workspace** for synchronized data,
chat, Review Inbox, and agent-run controls. A remembered server session can be
switched off while local mode is active and reactivated without entering the PIN
again. The native Android interface follows the device language and includes
English and Korean resources.

## Inbox notes

Open **Inbox → Notes** to capture ideas, references, and free-form text. Notes are
stored separately from tasks. Long-press a note and drop it onto a project chip to
file it, or use **Move to project**. Tap a project chip to browse its notes; use
**Undo move** to restore the previous assignment. Notes support editing and deletion.
Android stores notes on the device in local mode and on the connected server in
server mode. Updating an existing installation preserves its data and identity.

## Make targets

| Target | Description |
|--------|-------------|
| `make setup` | Install all dependencies and create `.env` |
| `make dev` | Run frontend and backend concurrently |
| `make dev-frontend` | Run frontend only |
| `make dev-backend` | Run backend only |
| `make docker` | Build and start with Docker Compose |
| `make docker-ollama` | Same as above, plus a local Ollama container |
| `make test` | Run tests |
| `make typecheck` | TypeScript type checking |
| `make build` | Production build |
| `make clean` | Remove generated files and caches |
