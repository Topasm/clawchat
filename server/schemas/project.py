"""API contracts for first-class projects."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from domain.project import ProjectStatus


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    goal: str | None = None
    description: str | None = None
    status: ProjectStatus = ProjectStatus.ACTIVE
    deadline: datetime | None = None
    default_execution_provider: str | None = None
    default_execution_model: str | None = None
    execution_workspace_path: str | None = None
    execution_workspace_isolation: str = Field(default="local", pattern="^(local|worktree)$")
    execution_base_branch: str | None = None


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    goal: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    deadline: datetime | None = None
    default_execution_provider: str | None = None
    default_execution_model: str | None = None
    execution_workspace_path: str | None = None
    execution_workspace_isolation: str | None = Field(default=None, pattern="^(local|worktree)$")
    execution_base_branch: str | None = None


class ProjectResponse(BaseModel):
    id: str
    title: str
    goal: str | None = None
    description: str | None = None
    status: ProjectStatus
    deadline: datetime | None = None
    root_task_id: str | None = None
    graph_revision: int = Field(ge=0)
    default_execution_provider: str | None = None
    default_execution_model: str | None = None
    execution_workspace_path: str | None = None
    execution_workspace_isolation: str = "local"
    execution_base_branch: str | None = None
    created_at: datetime
    updated_at: datetime
    task_count: int = Field(default=0, ge=0)
    completed_task_count: int = Field(default=0, ge=0)
    conversation_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ProjectOverviewResponse(ProjectResponse):
    ready_count: int = Field(default=0, ge=0)
    blocked_count: int = Field(default=0, ge=0)
    at_risk_count: int = Field(default=0, ge=0)
    running_agent_count: int = Field(default=0, ge=0)
    pending_review_count: int = Field(default=0, ge=0)
    critical_path_minutes: int | None = Field(default=None, ge=0)
