# AI Secretary — Project Vision & Goals

## Overview

**AI Secretary** is a privacy-first, self-hosted personal assistant application that unifies task management, calendar, notes, and AI-powered conversation into a single mobile app backed by a user-owned server.

Unlike existing productivity tools that scatter user data across multiple third-party cloud services, AI Secretary keeps all personal data on the user's own infrastructure. The AI assistant serves as the central interface — users interact through natural language conversation, and the system intelligently routes requests to the appropriate internal modules.

---

## Problem Statement

Modern knowledge workers rely on a fragmented ecosystem of productivity tools: separate apps for to-dos, calendars, notes, and AI assistants. This fragmentation creates three critical problems:

### 1. Privacy Erosion
Every tool stores data on its own cloud. Conversations with AI assistants, personal schedules, task lists, and private notes are distributed across dozens of third-party servers. Users have little visibility into how this data is stored, processed, or shared. For researchers, professionals, and privacy-conscious individuals, this is an unacceptable trade-off.

### 2. Context Fragmentation
When tools don't talk to each other, the user becomes the integration layer. You check your calendar in one app, your to-dos in another, and ask an AI assistant in a third — but the AI has no awareness of your schedule or tasks. The result is constant context-switching and manual coordination that wastes cognitive energy.

### 3. Passive Tools
Traditional productivity apps are passive containers. They store what you put in and display it back. They don't proactively remind you of approaching deadlines, prepare daily briefings, or automatically execute delegated tasks. The user must initiate every interaction.

---

## Vision

**A single app where conversation is the interface, your server is the backend, and AI is the engine that ties everything together.**

The user opens the app, says "Schedule a meeting with Haechan tomorrow at 3 PM about VLA model review," and the system:
1. Parses the natural language intent
2. Creates a calendar event with the correct time, title, and participant
3. Sets a reminder
4. Confirms the action in conversational language
5. Reflects the change immediately on the home screen widget

No app-switching. No manual entry. No data leaving the user's server.

---

## Goals

### G1. Privacy by Architecture
Data sovereignty is not a feature — it is the architecture. All data (conversations, tasks, events, notes) is stored exclusively on the user's self-hosted server. The mobile app communicates only with this server over HTTPS. No telemetry, no analytics, no third-party data processing. If the user chooses a local LLM (e.g., Ollama), even AI inference stays on-premise.

### G2. Conversation as the Primary Interface
Natural language is the most intuitive input method. The AI chat is the main screen and the primary way users interact with all features. Users should be able to:
- Create, query, update, and delete tasks, events, and notes through conversation
- Ask contextual questions ("What's left on my to-do list this week?", "When is my next meeting?")
- Delegate work to the AI agent ("Summarize the latest papers on VLA models")

Direct manipulation UI (tapping, swiping) remains available for all features, but conversation should always be a viable alternative.

### G3. Unified Data Model
Todos, calendar events, notes, and conversations live in a single database on the user's server. This unified model enables:
- **Cross-module awareness**: The AI knows your schedule when suggesting task priorities
- **Full-text search**: One search query spans all data types
- **Traceability**: Every item links back to the conversation that created it

### G4. Widget-Native Mobile Experience
The app is designed for glanceability. Home screen widgets provide instant access to:
- Today's tasks with completion status
- Upcoming calendar events
- Recent notes
- Quick AI input (speak or type a command without opening the app)

Widgets are not an afterthought — they are first-class citizens of the UX.

### G5. Proactive AI Agent
The AI does not wait to be asked. Based on the user's data, it can:
- Generate a daily morning briefing (today's schedule, pending tasks, reminders)
- Trigger reminders before deadlines and meetings
- Automatically execute delegated tasks (research, drafting, summarization)
- Surface forgotten or overdue items

The agent operates on a scheduler, checking for actionable items and delivering results via push notification.

### G6. Self-Hosted, One-Command Deployment
The server ships as a Docker Compose package. A single `docker compose up` launches the entire backend — API server, database, and optionally a local LLM. No manual configuration of databases, reverse proxies, or model downloads. The target audience includes technically capable individuals who own or rent a server (home lab, VPS, university server) but don't want to spend hours on DevOps.

### G7. Optional External Integrations
While the system is fully functional in isolation, users may optionally connect:
- **Google Calendar**: Bidirectional sync so events appear in both systems
- **Cloud LLM APIs** (e.g., Claude, GPT): For users who prefer stronger models over local inference

All integrations are opt-in and configured through the app's settings screen. When disabled, no external API calls are made.

---

## Non-Goals

To maintain focus and avoid scope creep, the following are explicitly **not** goals for the initial release:

- **Multi-user / team collaboration**: This is a personal assistant, not a team workspace.
- **End-to-end encryption**: The server is self-hosted and trusted. E2E encryption between app and server adds complexity without meaningful security benefit in this threat model.
- **Web client**: The React Native app is the sole client. A web dashboard may be considered in the future.
- **App Store distribution**: Initial distribution is via sideloading (APK) and TestFlight. Public store listing is a future consideration.
- **Plugin / extension system**: The module architecture supports future extensibility, but a formal plugin API is out of scope.

---

## Target Users

**Researchers and graduate students** who manage complex, overlapping projects with deadlines, meetings, and literature review — and who care about where their data lives.

**Privacy-conscious professionals** who want AI assistance without surrendering personal data to cloud services.

**Self-hosters and home lab enthusiasts** who already run services on their own infrastructure and want to add a personal AI assistant to their stack.

---

## Architecture Summary

```
┌─ ClawChat Desktop / Web App ───────────────────────┐
│                                                      │
│   Electron (desktop)    Pages (React + TypeScript)   │
│   Web Browser (Vite)    ├── Today, Inbox, Chat       │
│   Capacitor (planned)   ├── Kanban Board (All Tasks) │
│                         ├── Task/Event Detail        │
│                         └── Settings                 │
│                                                      │
└──────────────────────┬───────────────────────────────┘
                       │ REST + SSE Streaming (HTTPS)
                       │ User's own server only
┌──────────────────────┼───────────────────────────────┐
│  Self-Hosted Server  │                                │
│                      │                                │
│   FastAPI Backend                                     │
│   ├── AI Engine (Intent Classification + Orchestrator)│
│   ├── Modules (Todo, Calendar, Memo, Agent)           │
│   ├── Scheduler (Reminders, Briefing, Auto-tasks)     │
│   └── Services (Google Calendar sync, Notifications)  │
│                                                       │
│   Local Database (SQLite)                             │
│   All conversations, tasks, events, notes stored here │
│                                                       │
│   LLM (Ollama local or Claude API)                    │
└───────────────────────────────────────────────────────┘
```

---

## Success Criteria

The project is considered successful when a user can:

1. Install the server with a single `docker compose up` command
2. Connect the desktop/web app by entering their server address
3. Add a task, event, or note entirely through conversation
4. See the result reflected on the kanban board and today dashboard immediately
5. Receive a morning briefing summarizing their day
6. Delegate a research task to the AI and receive results via notification
7. Verify that no data has left their server by inspecting network traffic

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Desktop shell | Electron | Native desktop app (Windows, macOS, Linux) |
| Web framework | Vite + React 18 + TypeScript | Fast builds, type safety, single codebase |
| Server framework | Python FastAPI | Async, fast, excellent for AI workloads |
| Database | SQLite | Zero-config, single-file, sufficient for single-user |
| State management | Zustand | Lightweight, minimal boilerplate |
| Styling | CSS custom properties + BEM | Theme-aware, no runtime CSS-in-JS overhead |
| LLM abstraction | Ollama + Claude API | Local-first with cloud fallback option |
| Deployment | Docker Compose | One-command setup, reproducible environment |
| Real-time | SSE (Server-Sent Events) | Streaming AI responses |
| Auth | JWT (PIN-based) | Simple, sufficient for single-user self-hosted |

---

## Guiding Principles

**Conversation first, UI second.** Every feature must be accessible through natural language. The graphical UI is a complement, not the primary interface.

**Local by default, cloud by choice.** The system works fully offline (with local LLM). Cloud services are optional enhancements.

**One app, one server, one database.** Resist the temptation to split into microservices. Simplicity is a feature for self-hosted software.

**Ship incrementally.** Start with basic CRUD + chat. Add intelligence (intent classification, agents, briefings) in layers. A working simple system beats a broken ambitious one.