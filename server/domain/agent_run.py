"""Canonical lifecycle values for one agent execution attempt."""

from enum import StrEnum


class AgentRunStatus(StrEnum):
    QUEUED = "queued"
    STARTING = "starting"
    RUNNING = "running"
    WAITING_INPUT = "waiting_input"
    WAITING_REVIEW = "waiting_review"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


AGENT_RUN_ACTIVE_STATUSES = (
    AgentRunStatus.QUEUED,
    AgentRunStatus.STARTING,
    AgentRunStatus.RUNNING,
    AgentRunStatus.WAITING_INPUT,
    AgentRunStatus.WAITING_REVIEW,
)
AGENT_RUN_EXECUTING_STATUSES = (
    AgentRunStatus.QUEUED,
    AgentRunStatus.STARTING,
    AgentRunStatus.RUNNING,
)
AGENT_RUN_STATUS_VALUES = tuple(status.value for status in AgentRunStatus)
AGENT_RUN_STATUS_CHECK_SQL = "status IN (" + ", ".join(
    f"'{status}'" for status in AGENT_RUN_STATUS_VALUES
) + ")"
