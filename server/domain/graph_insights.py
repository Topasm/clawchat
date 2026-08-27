"""Deterministic execution-graph insight values shared by API clients."""

from enum import StrEnum


class GraphScopeRole(StrEnum):
    """Why a task is present in one graph-insight snapshot."""

    ROOT = "root"
    DESCENDANT = "descendant"
    CONTEXT = "context"
    GLOBAL = "global"


class GraphExecutionState(StrEnum):
    """Derived execution state without replacing the persisted task status."""

    PENDING = "pending"
    READY = "ready"
    BLOCKED = "blocked"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class GraphDueRisk(StrEnum):
    """Conservative due-date assessment for a task."""

    NONE = "none"
    OVERDUE = "overdue"
    BLOCKED = "blocked"
    INSUFFICIENT_TIME = "insufficient_time"
    UNKNOWN_ESTIMATE = "unknown_estimate"


class GraphIssueSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class GraphIssueCode(StrEnum):
    DEPENDENCY_CYCLE = "dependency_cycle"
    SELF_DEPENDENCY = "self_dependency"
    DUPLICATE_DEPENDENCY = "duplicate_dependency"
    MISSING_DEPENDENCY = "missing_dependency"
    PARENT_CYCLE = "parent_cycle"
    MISSING_PARENT = "missing_parent"
    DUE_DATE_CONFLICT = "due_date_conflict"
    CANCELLED_PREREQUISITE = "cancelled_prerequisite"
    INVALID_ESTIMATE = "invalid_estimate"
    LIFECYCLE_CONFLICT = "lifecycle_conflict"
