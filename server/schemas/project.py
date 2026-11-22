"""API contracts for first-class projects."""

import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.project import ProjectAutonomy, ProjectStatus
from schemas._utc import UtcDatetime

#: A policy chain is short: each skill is one pass over the task.
MAX_SKILL_CHAIN_LENGTH = 6


def _skill_chain_from_storage(value):
    """The model keeps the chain as JSON text; the contract is a list."""
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return None
        return parsed if isinstance(parsed, list) else None
    return value


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    goal: str | None = None
    description: str | None = None
    execution_instructions: str | None = None
    status: ProjectStatus = ProjectStatus.ACTIVE
    deadline: datetime | None = None
    default_execution_provider: str | None = None
    default_execution_model: str | None = None
    execution_workspace_path: str | None = None
    execution_workspace_isolation: str = Field(
        default="local", pattern="^(local|worktree)$"
    )
    execution_base_branch: str | None = None
    #: What the project does by itself once a task is ready.
    autonomy: ProjectAutonomy = ProjectAutonomy.MANUAL
    #: Skill ids the policy runs on each ready task, in order.
    default_skill_chain: list[str] | None = Field(
        default=None, max_length=MAX_SKILL_CHAIN_LENGTH
    )


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    goal: str | None = None
    description: str | None = None
    execution_instructions: str | None = None
    status: ProjectStatus | None = None
    deadline: datetime | None = None
    default_execution_provider: str | None = None
    default_execution_model: str | None = None
    execution_workspace_path: str | None = None
    execution_workspace_isolation: str | None = Field(
        default=None, pattern="^(local|worktree)$"
    )
    execution_base_branch: str | None = None
    autonomy: ProjectAutonomy | None = None
    default_skill_chain: list[str] | None = Field(
        default=None, max_length=MAX_SKILL_CHAIN_LENGTH
    )


class ProjectResponse(BaseModel):
    id: str
    title: str
    goal: str | None = None
    description: str | None = None
    execution_instructions: str | None = None
    status: ProjectStatus
    deadline: UtcDatetime | None = None
    root_task_id: str | None = None
    graph_revision: int = Field(ge=0)
    default_execution_provider: str | None = None
    default_execution_model: str | None = None
    execution_workspace_path: str | None = None
    execution_workspace_isolation: str = "local"
    execution_base_branch: str | None = None
    #: What the project does by itself once a task is ready; see
    #: ``services.automation.project_autonomy_service``.
    autonomy: ProjectAutonomy = ProjectAutonomy.MANUAL
    #: Skill ids the policy runs on each ready task, in order.
    default_skill_chain: list[str] | None = None
    created_at: UtcDatetime
    updated_at: UtcDatetime
    task_count: int = Field(default=0, ge=0)
    completed_task_count: int = Field(default=0, ge=0)
    conversation_id: str | None = None
    #: Where this project's work runs: the chosen execution host, its label,
    #: and whether that machine is reachable right now (None when unset).
    execution_host_id: str | None = None
    execution_host_label: str | None = None
    execution_host_online: bool | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("default_skill_chain", mode="before")
    @classmethod
    def _parse_skill_chain(cls, value):
        return _skill_chain_from_storage(value)


class ProjectOverviewResponse(ProjectResponse):
    ready_count: int = Field(default=0, ge=0)
    blocked_count: int = Field(default=0, ge=0)
    at_risk_count: int = Field(default=0, ge=0)
    running_agent_count: int = Field(default=0, ge=0)
    pending_review_count: int = Field(default=0, ge=0)
    critical_path_minutes: int | None = Field(default=None, ge=0)
