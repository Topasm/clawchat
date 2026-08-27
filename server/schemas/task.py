"""Pydantic schemas for agent tasks and planning."""

import json
from datetime import date, datetime
from typing import Annotated, Literal

from domain.plan_proposal import PlanProposalStatus, VaultSyncJobStatus
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


class AgentTaskResponse(BaseModel):
    id: str
    task_type: str
    instruction: str
    status: str
    result: str | None = None
    error: str | None = None
    parent_task_id: str | None = None
    agent_type: str = "general"
    skill_chain: list[str] | None = None
    current_skill_index: int = 0
    progress: int = 0
    progress_message: str | None = None
    sub_task_count: int = 0
    completed_sub_tasks: int = 0
    todo_id: str | None = None
    payload: dict | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    sub_tasks: list["AgentTaskResponse"] | None = None

    model_config = {"from_attributes": True}

    @field_validator("payload", mode="before")
    @classmethod
    def _parse_payload(cls, v: object) -> dict | None:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return None
        return v  # type: ignore[return-value]

    @field_validator("skill_chain", mode="before")
    @classmethod
    def _parse_skill_chain(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return None
        return v  # type: ignore[return-value]


# -- Plan schemas ------------------------------------------------------------


def _non_blank(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("must not be blank")
    return normalized


NonBlankPlanId = Annotated[
    str,
    StringConstraints(min_length=1, max_length=128),
    AfterValidator(_non_blank),
]
PlanTitle = Annotated[
    str,
    StringConstraints(min_length=1, max_length=500),
    AfterValidator(_non_blank),
]
PlanPriority = Literal["low", "medium", "high", "urgent"]
PlanIndex = Annotated[int, Field(ge=0, le=49)]


class _StrictPlanModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanSubtask(_StrictPlanModel):
    title: PlanTitle
    description: str | None = Field(default=None, max_length=10_000)
    estimated_minutes: int | None = Field(default=None, ge=1, le=10_080)
    due_date: date | None = None
    priority: PlanPriority | None = None
    depends_on_indices: list[PlanIndex] = Field(
        default_factory=list,
        max_length=50,
    )

    @field_validator("due_date", mode="before")
    @classmethod
    def _require_iso_date(cls, value: object) -> object:
        if value is None or isinstance(value, date) and not isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            raise TypeError("due_date must be an ISO date (YYYY-MM-DD)")
        normalized = value.strip()
        try:
            parsed = date.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("due_date must be an ISO date (YYYY-MM-DD)") from exc
        if parsed.isoformat() != normalized:
            raise ValueError("due_date must be an ISO date (YYYY-MM-DD)")
        return parsed


class PlanPayload(_StrictPlanModel):
    """Strict, persisted payload returned by the task planning model."""

    summary: str = Field(default="", max_length=5000)
    suggested_root_due_date: date | None = None
    suggested_skills: list[str] = Field(default_factory=list, max_length=20)
    suggested_assignee: str | None = Field(default=None, max_length=128)
    suggested_project_title: str | None = Field(default=None, max_length=500)
    subtasks: list[PlanSubtask] = Field(min_length=1, max_length=50)

    @field_validator("suggested_root_due_date", mode="before")
    @classmethod
    def _require_iso_root_date(cls, value: object) -> object:
        return PlanSubtask._require_iso_date(value)

    @field_validator("suggested_skills")
    @classmethod
    def _normalize_skills(cls, value: list[str]) -> list[str]:
        normalized = [_non_blank(skill) for skill in value]
        if len(normalized) != len(set(normalized)):
            raise ValueError("suggested_skills contains duplicates")
        return normalized

    @field_validator("suggested_assignee", "suggested_project_title")
    @classmethod
    def _normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _non_blank(value)


class PlanGenerateRequest(_StrictPlanModel):
    """Optional user guidance for a fresh AI graph proposal."""

    instructions: str | None = Field(default=None, max_length=2000)


class PlanApplyRequest(_StrictPlanModel):
    """Selection and optional user edits applied to one exact proposal."""

    proposal_id: NonBlankPlanId
    base_graph_revision: int = Field(ge=0)
    selected_indices: list[PlanIndex] | None = Field(default=None, max_length=50)
    subtasks: list[PlanSubtask] | None = Field(
        default=None,
        min_length=1,
        max_length=50,
    )

    @model_validator(mode="after")
    def _reject_duplicate_selection(self) -> "PlanApplyRequest":
        if self.selected_indices is not None:
            if not self.selected_indices:
                raise ValueError("Select at least one subtask")
            if len(self.selected_indices) != len(set(self.selected_indices)):
                raise ValueError("selected_indices contains duplicates")
        return self


class PlanDismissRequest(_StrictPlanModel):
    proposal_id: NonBlankPlanId


class PlanDismissResponse(BaseModel):
    status: Literal["rejected"]
    todo_id: str
    proposal_id: str


class PlanValidationIssue(_StrictPlanModel):
    code: str
    message: str
    path: str | None = None


class PlanValidationResult(_StrictPlanModel):
    errors: list[PlanValidationIssue] = Field(default_factory=list)
    warnings: list[PlanValidationIssue] = Field(default_factory=list)


class PlanProposalDiff(_StrictPlanModel):
    add_task_count: int = Field(ge=0)
    add_relationship_count: int = Field(ge=0)
    root_update_fields: list[str] = Field(default_factory=list)


class PlanResponse(BaseModel):
    """Plan generated by the planner for a todo."""

    proposal_id: str
    task_id: str  # Deprecated alias for proposal_id.
    agent_task_id: str | None = None
    todo_id: str
    base_graph_revision: int | None = None
    status: PlanProposalStatus
    validation: PlanValidationResult = Field(default_factory=PlanValidationResult)
    diff: PlanProposalDiff
    summary: str
    suggested_root_due_date: date | None = None
    suggested_assignee: str | None = None  # legacy
    suggested_skills: list[str] | None = None  # new
    suggested_project_title: str | None = None
    subtasks: list[PlanSubtask] = Field(default_factory=list)
    created_at: datetime

    # Computed display fields
    subtask_count: int = 0
    suggested_due_summary: str | None = None
    suggested_assignee_label: str | None = None  # legacy
    suggested_skills_labels: list[str] | None = None  # new
    suggested_project_label: str | None = None


class PlanApplyResponse(BaseModel):
    """Result of applying a plan to a todo."""

    todo_id: str
    proposal_id: str
    change_set_id: str
    applied_graph_revision: int
    created_subtask_ids: list[str] = Field(default_factory=list)
    created_relationships: int = 0
    root_update_fields: list[str] = Field(default_factory=list)
    project_folder_created: str | None = None
    already_applied: bool = False
    can_undo: bool = True
    vault_sync_status: VaultSyncJobStatus = VaultSyncJobStatus.PENDING


class PlanUndoResponse(BaseModel):
    change_set_id: str
    proposal_id: str
    todo_id: str
    reverted_graph_revision: int
    reverted_subtask_ids: list[str] = Field(default_factory=list)
    already_reverted: bool = False
    vault_sync_status: VaultSyncJobStatus = VaultSyncJobStatus.PENDING


class OrganizeRequest(BaseModel):
    """Trigger inbox organization for a todo."""


class DelegateRequest(BaseModel):
    """Delegate a todo to a skill (or legacy agent persona)."""

    skill_id: str | None = None  # preferred
    agent_type: str | None = None  # legacy fallback
    execution_provider: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=200)


class SkillResponse(BaseModel):
    """Public representation of a registered skill."""

    id: str
    name: str
    description: str
    tags: list[str] = []
