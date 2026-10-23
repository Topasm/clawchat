<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="ClawChat icon">
</p>

<h1 align="center">ClawChat</h1>

<p align="center"><b>A privacy-first, self-hosted agentic todo app.</b><br>
Capture work, let it become a plan, hand ready tasks to an AI agent, and review what comes back. On your own server.</p>

<p align="center">
  <a href="https://github.com/Topasm/clawchat/releases/latest"><img src="https://img.shields.io/github/v/release/Topasm/clawchat?label=release" alt="Latest release"></a>
  <a href="https://github.com/Topasm/clawchat/actions/workflows/ci.yml"><img src="https://github.com/Topasm/clawchat/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Topasm/clawchat" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platforms-web%20%C2%B7%20desktop%20%C2%B7%20android-blue" alt="Web, desktop and Android">
</p>

<p align="center"><b>English</b> · <a href="README.ko.md">한국어</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/web-tasks-pane-dark.png">
  <img alt="ClawChat: the task list with a task open beside it, its agent run waiting for an answer" src="docs/media/web-tasks-pane-light.png" width="100%">
</picture>

<p align="center">
  <img src="docs/media/inbox-to-answer.gif" alt="Walkthrough: write a thought into the Inbox, open the task it became, answer the agent's question" width="100%">
  <br><sub>Write something into the Inbox, open the task, answer the question the agent left for you.</sub>
</p>

## Why ClawChat

- **Plan.** Turn goals and inbox captures into projects, steps and a dependency-aware plan. The next ready task is always visible.
- **Act.** Run a ready task with Claude Code, the Codex CLI, the Codex API, OpenCode, Ollama or any OpenAI-compatible model. Agents can search the web and use MCP servers you allow.
- **Review.** Every result stops for you. Approve it, ask for changes, or answer the agent's question, and see which tasks become ready next.
- **Stay in control.** One FastAPI server and one SQLite file that you own. Risky changes wait for explicit approval; nothing leaves your machine unless you point it at a model somewhere else.

## Screens

<table>
  <tr>
    <td align="center"><b>Inbox</b></td>
    <td align="center"><b>Today</b></td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/web-inbox-dark.png"><img alt="Inbox: what was sorted automatically, and what still needs a hand" src="docs/media/web-inbox-light.png" width="100%"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/web-today-dark.png"><img alt="Today: what is due, what is overdue, what the calendar suggests" src="docs/media/web-today-light.png" width="100%"></picture></td>
  </tr>
  <tr>
    <td>Write a line, and it becomes a task, a note or a dated reminder by itself. What could not be sorted waits with two buttons.</td>
    <td>Due today, overdue, the day's events and what the calendar suggests, with one place to undo anything added for you.</td>
  </tr>
  <tr>
    <td align="center"><b>Project</b></td>
    <td align="center"><b>Progress</b></td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/web-project-flow-dark.png"><img alt="Project: the plan as a flow, with the blocked branch and what needs attention" src="docs/media/web-project-flow-light.png" width="100%"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/web-attention-dark.png"><img alt="Progress: a question to answer, a result to review, a failed run to decide on" src="docs/media/web-attention-light.png" width="100%"></picture></td>
  </tr>
  <tr>
    <td>Steps drawn left to right with what blocks what, a folder on each machine the project runs on, and the agent questions and results waiting for you.</td>
    <td>Only what needs a person: a question to answer in place, a low-risk result to approve, a failed run to retry. The run log and review history are one tab away.</td>
  </tr>
  <tr>
    <td align="center"><b>Schedule</b></td>
    <td align="center"><b>Chat</b></td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/web-week-dark.png"><img alt="Schedule: the week with calendar events and task deadlines side by side" src="docs/media/web-week-light.png" width="100%"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/web-chat-dark.png"><img alt="Chat: a thread tied to a project, where an agent run reports back" src="docs/media/web-chat-light.png" width="100%"></picture></td>
  </tr>
  <tr>
    <td>Your calendars (CalDAV, Google) next to task deadlines. Free stretches are found for work with a due date.</td>
    <td>Ask for anything in plain language. A thread can belong to a project, and the agent's result lands in it for review.</td>
  </tr>
</table>

Screens follow your system theme. Every one above has a dark version; switch GitHub to dark to see it.

## Phone and desktop

<p align="center">
  <img src="android/feature/today/src/test/screenshots/today_screen_light_agents.png" width="19%" alt="Android: Today">
  <img src="android/feature/inbox/src/test/screenshots/inbox_lists_light.png" width="19%" alt="Android: Inbox">
  <img src="android/feature/tasks/src/test/screenshots/tasks_detail_light.png" width="19%" alt="Android: a task">
  <img src="android/feature/progress/src/test/screenshots/progress_now_light.png" width="19%" alt="Android: Progress">
  <img src="android/feature/planner/src/test/screenshots/week_page_light.png" width="19%" alt="Android: the week">
</p>

- **Android** is a native app. Use it on its own as an offline todo with a calendar, reminders, share-to-capture and a home-screen widget, or pair it with your server (a 6-digit code or a QR code) for shared projects, chat, review and agent runs. Answer an agent's question or approve a low-risk result straight from the notification.
- **Desktop** (Linux, macOS, Windows) ships the same interface in a native window with the server built in, so one install is a complete workspace. A desktop app can also act as a worker: runs addressed to that machine execute there, with write access confined to the project's folder.
- **Web** is the same renderer served by your server, for any browser on your network.

## How it works

Every task moves through five steps, and every screen shows the same five: **Captured → Plan → Run → Review → Done**.

1. **Capture** anything into the Inbox, from any device. It is sorted into a task, a note or a dated reminder; what cannot be sorted waits for one tap.
2. **Plan** a project as steps with prerequisites. "Waiting on" is computed for you, so the next ready task is never a guess.
3. **Run** a ready task with a chain of skills (plan, research, draft, summarize, code review, data analysis, prioritize, weekly review, Obsidian sync, or your own `SKILL.md`). The run can ask you a question and wait.
4. **Review** the result. Low-risk results from read-only skills can be adopted automatically once you have approved a few; anything that writes waits for you.
5. **Done** unlocks whatever depended on it.

Around the loop: calendars sync both ways over CalDAV, suggestions are drawn from upcoming exams, deadlines and meetings, an Obsidian vault can be shared read-only with the agents, and scheduled automations run the same chains on a timer.

## Get it

| Platform | Download |
|---|---|
| Linux | `.AppImage` or `.deb` from the [latest release](https://github.com/Topasm/clawchat/releases/latest) |
| macOS (Apple silicon) | `.dmg` from the [latest release](https://github.com/Topasm/clawchat/releases/latest) |
| Windows | `-setup.exe` from the [latest release](https://github.com/Topasm/clawchat/releases/latest) |
| Android | `.apk` from the [latest release](https://github.com/Topasm/clawchat/releases/latest); the app updates itself afterwards |

Desktop builds are unsigned: macOS asks you to allow the app in **System Settings → Privacy & Security** the first time.

**Server with Docker** (web and Android clients connect to it):

```bash
cp .env.example .env     # set PIN and your AI provider
docker compose up --build -d
```

Add `--profile ollama` for a local model, `--profile search` for private web search. See [Deployment](docs/deployment.md).

**From source** (Node.js ≥ 22, Python ≥ 3.11, uv 0.10.2):

```bash
make setup
make dev                 # web on :5173, API on :8000
```

AI features need one of: Ollama, an OpenAI-compatible endpoint, Claude Code, the Codex CLI, or the Codex API. Everything else works without one.

## Privacy

ClawChat is a single FastAPI process and a single SQLite database on a machine you choose, behind a PIN. Calendar secrets are stored encrypted. Shared folders are indexed by path and title only, never by content. Agent runs on your machines are sandboxed to the project's folder, and results that write anywhere wait for your approval. There is no account, no telemetry and no cloud in the middle.

## Documentation

- [Setup guide](docs/setup.md): agent tools (web search, MCP servers), your own skills, CalDAV and Google calendars, the Android modes, `make` targets
- [Deployment](docs/deployment.md): Docker, environment variables, production settings
- [Architecture](docs/architecture.md) and the [platform matrix](docs/architecture/platform-matrix.md)
- [Backend guide](docs/backend-guide.md), [frontend guide](docs/frontend-guide.md), [API design](docs/api-design.md)
- [Desktop releases](docs/desktop-release.md), [Android releases](docs/android-release.md)
- [README media](docs/readme-media.md): how the screenshots above are rendered
- [Everything else](docs/README.md)

## License

[MIT](LICENSE)
