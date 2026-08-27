"""Canonical review, artifact, and revision lifecycle values."""

from enum import StrEnum


class ReviewSubjectType(StrEnum):
    PLAN_PROPOSAL = "plan_proposal"
    ARTIFACT_REVISION = "artifact_revision"
    AGENT_RUN = "agent_run"
    CODE_DIFF = "code_diff"
    SCHEDULE_CHANGE = "schedule_change"
    SYNC_CONFLICT = "sync_conflict"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"
    REJECTED = "rejected"
    EXPIRED = "expired"


class ReviewRiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ArtifactType(StrEnum):
    PROJECT_BRIEF = "project_brief"
    REQUIREMENTS = "requirements"
    ACCEPTANCE_CRITERIA = "acceptance_criteria"
    RESEARCH_NOTE = "research_note"
    DECISION = "decision"
    REPORT = "report"
    CODE_DIFF = "code_diff"
    GENERATED_FILE = "generated_file"
    EXTERNAL_LINK = "external_link"


class ArtifactRevisionStatus(StrEnum):
    APPROVED = "approved"
    PENDING = "pending"
    CHANGES_REQUESTED = "changes_requested"
    REJECTED = "rejected"


def enum_values(enum_type: type[StrEnum]) -> tuple[str, ...]:
    return tuple(item.value for item in enum_type)


def check_sql(column: str, enum_type: type[StrEnum]) -> str:
    return f"{column} IN (" + ", ".join(
        f"'{value}'" for value in enum_values(enum_type)
    ) + ")"
