# ClawChat

A privacy-first, self-hosted AI secretary that unifies task management, calendar, notes, and AI-powered conversation into a single mobile app backed by your own server.

## What is ClawChat?

ClawChat replaces the fragmented ecosystem of productivity apps with a single conversational interface. Tell it to "schedule a meeting with Haechan tomorrow at 3 PM" and it parses the intent, creates the calendar event, sets a reminder, and confirms — all without your data leaving your server.

## Features

- **Conversation-first interface** — manage tasks, events, and notes through natural language
- **Self-hosted backend** — all data stays on your server, zero third-party data processing
- **AI-powered intent classification** — automatically routes requests to the right module
- **Real-time streaming** — AI responses stream token-by-token via WebSocket
- **Interactive action cards** — confirm, edit, or delete AI-created items inline
- **Full-text search** — one search across all conversations, todos, events, and memos
- **Daily briefings** — automatic morning summaries of your schedule and tasks
- **Async agent tasks** — delegate research and summarization to the AI
- **Local LLM support** — use Ollama for fully offline, on-premise AI inference

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile App | React Native (Expo) |
| Chat UI | react-native-gifted-chat |
| State | Zustand |
| Backend | Python FastAPI |
| Database | SQLite |
| AI | Ollama (local) or OpenAI-compatible API |
| Deployment | Docker Compose |

## Quick Start

```bash
# 1. Clone and configure
git clone <repo-url> && cd clawchat
cp .env.example .env
# Edit .env: set JWT_SECRET, PIN, and AI settings

# 2. Launch server (with local Ollama)
docker compose -f docker-compose.ollama.yml up -d

# 3. Pull an AI model
docker compose exec ollama ollama pull llama3.2

# 4. Verify server is running
curl http://localhost:8000/api/health

# 5. Connect the mobile app
# Open ClawChat -> Enter your server URL and PIN
```

## Documentation

| Document | Description |
|----------|-------------|
| [Documentation Index](./docs/README.md) | Start here — full docs overview and tech stack |
| [Architecture](./docs/architecture.md) | System design, data flow, and design principles |
| [Database Schema](./docs/database-schema.md) | Tables, columns, indexes, and migration strategy |
| [API Design](./docs/api-design.md) | REST endpoints, WebSocket protocol, authentication |
| [Backend Guide](./docs/backend-guide.md) | FastAPI project structure and dev setup |
| [Frontend Guide](./docs/frontend-guide.md) | React Native app structure and reference patterns |
| [Deployment](./docs/deployment.md) | Docker setup and production configuration |
| [Roadmap](./docs/roadmap.md) | Phased development plan |

## Project Status

This project is in the early planning and documentation phase. See the [Roadmap](./docs/roadmap.md) for the development timeline.

## License

TBD
