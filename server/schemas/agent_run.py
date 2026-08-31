"""API contracts for durable agent execution attempts."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from domain.agent_run import AgentRunStatus
from domain.graph_insights import GraphExecutionState
from domain.task import TaskStatus


class AgentRunRetryRequest(BaseModel):
    provider: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, max_length=200)
    follow_up_instruction: str | None = Field(default=None, min_length=1, max_length=10_000)


class AgentRunResumeRequest(BaseModel):
    follow_up_instruction: str = Field(min_length=1, max_length=10_000)


class AgentRunTransitionRequest(BaseModel):
    status: AgentRunStatus
    message: str | None = Field(default=None, max_length=10_000)

    @model_validator(mode="after")
    def validate_transition(self):
        if self.status not in {
            AgentRunStatus.RUNNING,
            AgentRunStatus.WAITING_INPUT,
            AgentRunStatus.WAITING_REVIEW,
        }:
            raise ValueError("Only provider-controlled waiting/running states are accepted")
        return self


class AgentRunHeartbeatRequest(BaseModel):
    progress: int | None = Field(default=None, ge=0, le=100)
    message: str | None = Field(default=None, max_length=10_000)


class AgentRunRecoveryResponse(BaseModel):
    run_id: str
    todo_id: str
    todo_status: TaskStatus
    graph_revision: int = Field(ge=0)
    execution_state: GraphExecutionState
    is_ready: bool
    direct_blocker_ids: list[str] = Field(default_factory=list)


class AgentRunResponse(BaseModel):
    id: str
    agent_task_id: str
    project_id: str | None = None
    project_title: str | None = None
    todo_id: str | None = None
    todo_title: str | None = None
    todo_status: TaskStatus | None = None
    task_type: str
    instruction: str
    instruction_snapshot: str
    attempt: int = Field(ge=1)
    provider: str
    model: str | None = None
    host_id: str | None = None
    workspace_id: str | None = None
    external_run_id: str | None = None
    status: AgentRunStatus
    progress: int = Field(ge=0, le=100)
    progress_message: str | None = None
    result_summary: str | None = None
    error: str | None = None
    usage: dict[str, Any] | None = None
    is_adopted: bool = False
    created_at: datetime
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    completed_at: datetime | None = None
    cancel_requested_at: datetime | None = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentRunDetailResponse(AgentRunResponse):
    """Single-run inspection includes the full provider result.

    List responses deliberately keep only ``result_summary`` so a large agent
    transcript does not multiply the mobile payload size.
    """

    result: str | None = None


class AgentRunEventResponse(BaseModel):
    id: str
    run_id: str
    sequence: int = Field(ge=1)
    event_type: str
    message: str | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    payload: dict[str, Any] | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
