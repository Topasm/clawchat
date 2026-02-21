"""FastAPI application entry point for ClawChat."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import Base, engine
from routers import auth, calendar, chat, memo, notifications, search, today, todo

# Create all tables (safe to call repeatedly; no-ops for existing tables)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="ClawChat Server", version="0.1.0")

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


# ---------------------------------------------------------------------------
# Scheduler (reminders & overdue checks)
# ---------------------------------------------------------------------------

if settings.ENABLE_SCHEDULER:
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from services.scheduler import check_overdue_tasks, check_reminders

        scheduler = BackgroundScheduler()
        scheduler.add_job(check_reminders, "interval", seconds=settings.REMINDER_CHECK_INTERVAL)
        scheduler.add_job(check_overdue_tasks, "interval", minutes=5)
        scheduler.start()
    except ImportError:
        pass  # apscheduler not installed, skip
