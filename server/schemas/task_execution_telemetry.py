"""Task-scoped execution telemetry derived from runs, reviews, and artifacts."""

from datetime import datetime

from pydantic import BaseModel, Field

from domain.agent_run import AgentRunStatus
from domain.review import ArtifactType


class TaskExecutionTelemetryResponse(BaseModel):
    task_id: str
    latest_run_id: str | None = None
    latest_run_status: AgentRunStatus | None = None
    latest_run_progress: int | None = Field(default=None, ge=0, le=100)
    latest_run_provider: str | None = None
    latest_run_progress_message: str | None = None
    latest_run_updated_at: datetime | None = None
    human_wait_seconds: int = Field(default=0, ge=0)
    question_count: int = Field(default=0, ge=0)
    average_resume_seconds: int | None = Field(default=None, ge=0)
    pending_review_count: int = Field(default=0, ge=0)
    artifact_count: int = Field(default=0, ge=0)
    latest_artifact_id: str | None = None
    latest_artifact_title: str | None = None
    latest_artifact_type: ArtifactType | None = None
    latest_artifact_updated_at: datetime | None = None
