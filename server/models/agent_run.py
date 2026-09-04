"""Durable execution attempts and append-only execution events."""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.agent_run import (
    AGENT_RUN_STATUS_CHECK_SQL,
    AGENT_RUN_STATUS_VALUES,
    AgentRunStatus,
)
from utils import make_id


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: make_id("run_")
    )
    agent_task_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    instruction_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    #: Human-readable label of the machine that ran this, as the provider
    #: reported it.
    host_id: Mapped[str | None] = mapped_column(String, nullable=True)
    #: The registered ``execution_hosts`` row this run belongs to. Set when the
    #: work is claimed by a machine other than the server's own; no foreign key
    #: for the same reason ``projects.execution_host_id`` has none.
    execution_host_id: Mapped[str | None] = mapped_column(String, nullable=True)
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True)
    external_run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=AgentRunStatus.QUEUED,
        server_default=AgentRunStatus.QUEUED.value,
    )
    progress: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    progress_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_adopted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    @validates("status")
    def validate_status(self, _key, value):
        try:
            return AgentRunStatus(value).value
        except (TypeError, ValueError) as exc:
            allowed = ", ".join(AGENT_RUN_STATUS_VALUES)
            raise ValueError(
                f"Invalid agent run status {value!r}; expected one of: {allowed}"
            ) from exc

    __table_args__ = (
        CheckConstraint(AGENT_RUN_STATUS_CHECK_SQL, name="ck_agent_runs_status"),
        CheckConstraint("attempt >= 1", name="ck_agent_runs_attempt"),
        CheckConstraint(
            "progress >= 0 AND progress <= 100",
            name="ck_agent_runs_progress",
        ),
        UniqueConstraint(
            "agent_task_id", "attempt", name="uq_agent_runs_task_attempt"
        ),
        Index("idx_agent_runs_status_created", "status", "created_at"),
        Index("idx_agent_runs_project_status", "project_id", "status"),
        Index("idx_agent_runs_task_created", "agent_task_id", "created_at"),
        Index("idx_agent_runs_external_run_id", "external_run_id"),
        Index("idx_agent_runs_execution_host_id", "execution_host_id"),
    )


class AgentRunEvent(Base):
    __tablename__ = "agent_run_events"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: make_id("run_event_")
    )
    run_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("agent_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "progress IS NULL OR (progress >= 0 AND progress <= 100)",
            name="ck_agent_run_events_progress",
        ),
        UniqueConstraint("run_id", "sequence", name="uq_agent_run_events_sequence"),
        Index("idx_agent_run_events_run_sequence", "run_id", "sequence"),
    )
