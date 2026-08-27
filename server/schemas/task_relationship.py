"""API schemas for normalized task relationships."""

from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.json_schema import SkipJsonSchema

from domain.task_relationship import TaskRelationshipType

NonBlankString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


class _TaskRelationshipEndpoints(BaseModel):
    """Shared endpoint validation for relationship mutation payloads."""

    source_task_id: NonBlankString | SkipJsonSchema[None] = None
    target_task_id: NonBlankString | SkipJsonSchema[None] = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _reject_self_edge(self) -> Self:
        for field_name in ("source_task_id", "target_task_id"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        if (
            self.source_task_id is not None
            and self.target_task_id is not None
            and self.source_task_id == self.target_task_id
        ):
            raise ValueError("A task relationship cannot reference the same task")
        return self


class TaskRelationshipCreate(_TaskRelationshipEndpoints):
    """Create one directed, typed task edge."""

    source_task_id: NonBlankString
    target_task_id: NonBlankString
    type: TaskRelationshipType
    label: str | None = None


class TaskRelationshipUpdate(_TaskRelationshipEndpoints):
    """Patch fields on an existing edge.

    Endpoint and type fields are optional but cannot be explicitly null.
    ``label`` is the only nullable public mutation field. Provenance is
    assigned by the server and cannot be changed through this schema.
    """

    type: TaskRelationshipType | SkipJsonSchema[None] = None
    label: str | None = None

    @model_validator(mode="after")
    def _reject_null_required_fields(self) -> Self:
        if "type" in self.model_fields_set and self.type is None:
            raise ValueError("type cannot be null")
        return self


class TaskRelationshipResponse(BaseModel):
    """Persisted task edge returned by the API."""

    id: str
    source_task_id: str
    target_task_id: str
    type: TaskRelationshipType
    label: str | None = None
    created_by: str
    proposal_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskDependencyCommandRequest(BaseModel):
    """Revision-sensitive dependency connector command."""

    dependent_task_id: NonBlankString
    prerequisite_task_id: NonBlankString
    expected_graph_revision: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _reject_self_dependency(self) -> Self:
        if self.dependent_task_id == self.prerequisite_task_id:
            raise ValueError("A task cannot depend on itself")
        return self


class TaskDependencyInsightsDelta(BaseModel):
    ready_count: int = 0
    blocked_count: int = 0
    critical_path_minutes: int | None = None


class TaskDependencyPreviewResponse(BaseModel):
    dependent_task_id: str
    prerequisite_task_id: str
    base_graph_revision: int = Field(ge=0)
    affected_task_ids: list[str]
    insights_delta: TaskDependencyInsightsDelta | None = None


class TaskDependencyCommandResponse(TaskDependencyPreviewResponse):
    relationship: TaskRelationshipResponse
    graph_revision: int = Field(ge=0)
