# ClawChat Documentation

ClawChat (AI Secretary) is a privacy-first, self-hosted personal assistant that unifies task management, calendar, notes, and AI-powered conversation into a single mobile app backed by a user-owned server. Users interact through natural language, and the system intelligently routes requests to the appropriate internal modules.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture Overview](./architecture.md) | System design, data flow, and design principles |
| [Database Schema](./database-schema.md) | All tables, columns, indexes, and migration strategy |
| [API Design](./api-design.md) | REST endpoints, WebSocket protocol, and authentication |
| [Backend Guide](./backend-guide.md) | FastAPI project structure, modules, and dev setup |
| [Frontend Guide](./frontend-guide.md) | React Native app structure and reference pattern migrations |
| [Deployment](./deployment.md) | Docker setup, environment variables, and production config |
| [Roadmap](./roadmap.md) | Phased development plan (Weeks 1-9) |
| [UI/UX Redesign](./ui-redesign.md) | Things 3-style task management + chat integration |

## Key Features

- **AI Chat with Markdown Rendering** — Full markdown support in chat bubbles (code blocks with syntax labels, bold, italic, lists, tables, blockquotes) via `react-native-markdown-display`
- **SSE Streaming** — Real-time token-by-token AI response streaming using Server-Sent Events (SSE) with typing indicator and stop generation support
- **Dark Mode** — Light/Dark/System theme support with OLED-friendly pure black palette, applied across all screens and components
- **Message Interactions** — Long-press context menu (copy, regenerate, edit, delete) with haptic feedback, animated press states, and clipboard support
- **Configurable Settings** — 15+ user-configurable settings (chat behavior, LLM parameters, appearance, notifications) with JSON export/import
- **Task Management** — Things 3-inspired GTD workflow with Today dashboard, Inbox, quick capture, and natural language parsing
- **Calendar Integration** — Event management with time bars, all-day toggle, location, and reminders
- **Notes / Memos** — Quick note capture and search
- **Smart Send** — Auto-detect tasks and events from chat messages using keyword analysis
- **Android Widget** — Home screen widget for at-a-glance task overview
- **Push Notifications** — Expo push notification support for reminders and overdue task alerts

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Mobile App | React Native (Expo) | Cross-platform UI with native widget support |
| Navigation | React Navigation | Stack + bottom tab navigation |
| Chat UI | react-native-gifted-chat | Message bubbles, input toolbar, scrolling |
| Markdown | react-native-markdown-display | Rich markdown rendering in chat bubbles |
| State Management | Zustand | Lightweight global state (auth, chat, modules, settings) |
| HTTP Client | Axios | REST API communication |
| Real-time | SSE (Server-Sent Events) | Streaming AI responses via fetch + ReadableStream |
| Clipboard / Haptics | expo-clipboard, expo-haptics | Copy-to-clipboard and tactile feedback |
| Backend | Python FastAPI | Async API server with AI orchestration |
| Database | SQLite | Single-file, zero-config persistent storage |
| ORM / Migration | SQLAlchemy + Alembic | Schema management and migrations |
| AI Layer | Ollama / OpenAI-compatible API | Local-first LLM with cloud fallback |
| Deployment | Docker Compose | One-command server setup |

## Prerequisites

- **Node.js** >= 18 and npm/yarn
- **Python** >= 3.11
- **Expo CLI** (`npm install -g expo-cli`)
- **Docker & Docker Compose** (for server deployment)
- An **OpenAI-compatible LLM** endpoint (Ollama for local, or Claude/GPT API key)
