"""FastAPI application entry point for ClawChat."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import Base, SessionLocal, engine
from routers import auth, calendar, chat, memo, notifications, search, today, todo
from services.ai_service import AIService
from services.intent_classifier import IntentClassifier
from services.orchestrator import Orchestrator

logger = logging.getLogger(__name__)

# Create all tables (safe to call repeatedly; no-ops for existing tables)
Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------------------------
# Lifespan (startup + shutdown)
# ---------------------------------------------------------------------------

_scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle: start scheduler, cleanup on shutdown."""
    global _scheduler

    # Start scheduler if enabled
    if settings.ENABLE_SCHEDULER:
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from services.scheduler import check_overdue_tasks, check_reminders

            _scheduler = BackgroundScheduler()
            _scheduler.add_job(
                check_reminders,
                "interval",
                seconds=settings.REMINDER_CHECK_INTERVAL,
            )
            _scheduler.add_job(check_overdue_tasks, "interval", minutes=5)
            _scheduler.start()
            logger.info("Scheduler started (reminder interval=%ds)", settings.REMINDER_CHECK_INTERVAL)
        except ImportError:
            logger.warning("apscheduler not installed, scheduler disabled")

    yield

    # Shutdown
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")

    await app.state.ai_service.close()
    await app.state.intent_classifier.close()
    logger.info("AI services closed")


app = FastAPI(title="ClawChat Server", version="0.1.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Application state (shared services)
# ---------------------------------------------------------------------------

app.state.ai_service = AIService(
    provider=settings.AI_PROVIDER,
    base_url=settings.AI_BASE_URL,
    api_key=settings.AI_API_KEY,
    model=settings.AI_MODEL,
)
app.state.intent_classifier = IntentClassifier(
    provider=settings.AI_PROVIDER,
    base_url=settings.AI_BASE_URL,
    api_key=settings.AI_API_KEY,
    model=settings.AI_MODEL,
)
app.state.orchestrator = Orchestrator()
app.state.session_factory = SessionLocal

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(auth.router, prefix="/api/auth")
app.include_router(chat.router, prefix="/api/chat")
app.include_router(todo.router, prefix="/api/todos")
app.include_router(calendar.router, prefix="/api/events")
app.include_router(memo.router, prefix="/api/memos")
app.include_router(search.router, prefix="/api/search")
app.include_router(today.router, prefix="/api/today", tags=["today"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    """Basic health-check endpoint."""
    return {
        "status": "ok",
        "version": "0.1.0",
        "ai_provider": settings.AI_PROVIDER,
        "ai_model": settings.AI_MODEL,
    }
