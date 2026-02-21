"""AgentTask SQLAlchemy model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text

from database import Base


class AgentTask(Base):
    """Stores asynchronous AI agent tasks (research, summarization, etc.)."""

    __tablename__ = "agent_tasks"

    id = Column(String, primary_key=True, default=lambda: uuid4().hex)
    task_type = Column(
        String, nullable=False
    )  # research / summarize / draft / custom
    instruction = Column(Text, nullable=False)
    status = Column(
        String, nullable=False, default="queued"
    )  # queued / running / completed / failed
    result = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    conversation_id = Column(
        String, ForeignKey("conversations.id"), nullable=True
    )
    message_id = Column(String, ForeignKey("messages.id"), nullable=True)
    created_at = Column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_agent_tasks_status", "status"),
        Index("idx_agent_tasks_conversation_id", "conversation_id"),
    )
