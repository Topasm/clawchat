"""Named API contracts for deterministic task-graph insights."""

from datetime import datetime

from domain.graph_insights import (
    GraphDueRisk,
    GraphExecutionState,
    GraphIssueCode,
    GraphIssueSeverity,
    GraphScopeRole,
)
from domain.task import TaskStatus
from pydantic import BaseModel, Field


class GraphInsightScope(BaseModel):
    root_task_id: str | None = None
    task_count: int = Field(ge=0)
    primary_task_count: int = Field(ge=0)
    relationship_count: int = Field(ge=0)
    prerequisite_task_count: int = Field(ge=0)


class GraphInsightIssue(BaseModel):
    code: GraphIssueCode
    severity: GraphIssueSeverity
    task_ids: list[str] = Field(default_factory=list)
    related_task_ids: list[str] = Field(default_factory=list)
    message: str


class GraphInsightNode(BaseModel):
    task_id: str
    title: str
    status: TaskStatus
    parent_id: str | None = None
    scope_role: GraphScopeRole
    execution_state: GraphExecutionState
    estimated_minutes: int | None = None
    due_date: datetime | None = None
    dependency_ids: list[str] = Field(default_factory=list)
    direct_blocker_ids: list[str] = Field(default_factory=list)
    transitive_blocker_ids: list[str] = Field(default_factory=list)
    transitive_blocker_count: int = Field(
        ge=0,
        description=(
            "Exact count when transitive_blockers_truncated is false; "
            "otherwise a lower bound"
        ),
    )
    transitive_blockers_truncated: bool
    downstream_task_ids: list[str] = Field(default_factory=list)
    downstream_count: int = Field(
        ge=0,
        description=(
            "Exact count when downstream_truncated is false; otherwise a lower bound"
        ),
    )
    downstream_truncated: bool
    is_container: bool
    is_ready: bool
    is_blocked: bool
    is_unschedulable: bool
    is_on_critical_path: bool
    remaining_path_minutes: int | None = Field(default=None, ge=0)
    remaining_path_known_minutes: int = Field(ge=0)
    estimate_complete: bool
    due_risk: GraphDueRisk
    due_slack_minutes: int | None = None


class GraphInsightSummary(BaseModel):
    active_count: int = Field(ge=0)
    pending_count: int = Field(ge=0)
    in_progress_count: int = Field(ge=0)
    completed_count: int = Field(ge=0)
    cancelled_count: int = Field(ge=0)
    ready_count: int = Field(ge=0)
    blocked_count: int = Field(ge=0)
    at_risk_count: int = Field(ge=0)
    overdue_count: int = Field(ge=0)
    orphan_count: int = Field(ge=0)
    isolated_count: int = Field(ge=0)
    critical_path_task_ids: list[str] = Field(default_factory=list)
    critical_path_minutes: int | None = Field(default=None, ge=0)
    critical_path_known_minutes: int = Field(ge=0)
    critical_path_estimate_complete: bool
    unknown_estimate_task_ids: list[str] = Field(default_factory=list)
    unschedulable_task_ids: list[str] = Field(default_factory=list)
    unschedulable_count: int = Field(ge=0)
    cycle_count: int = Field(ge=0)
    missing_dependency_count: int = Field(ge=0)
    due_date_conflict_count: int = Field(ge=0)
    unknown_estimate_count: int = Field(ge=0)
    invalid_estimate_count: int = Field(ge=0)
    parent_cycle_count: int = Field(ge=0)
    missing_parent_count: int = Field(ge=0)
    cancelled_prerequisite_count: int = Field(ge=0)
    issue_count: int = Field(ge=0)
    is_healthy: bool


class GraphInsightsResponse(BaseModel):
    graph_revision: int = Field(ge=0)
    generated_at: datetime
    scope: GraphInsightScope
    nodes: list[GraphInsightNode]
    summary: GraphInsightSummary
    issues: list[GraphInsightIssue]
    issues_truncated: bool = False
