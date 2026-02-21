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

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Mobile App | React Native (Expo) | Cross-platform UI with native widget support |
| Navigation | React Navigation | Stack + bottom tab navigation |
| Chat UI | react-native-gifted-chat | Message bubbles, input toolbar, scrolling |
| State Management | Zustand | Lightweight global state (auth, chat, modules) |
| HTTP Client | Axios | REST API communication |
| Real-time | WebSocket | Streaming AI responses |
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
