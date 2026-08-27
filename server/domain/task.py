"""Canonical task domain values."""

from enum import StrEnum


class TaskStatus(StrEnum):
    """Persisted lifecycle state shared by every task client."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


TASK_STATUS_VALUES = tuple(status.value for status in TaskStatus)
TERMINAL_TASK_STATUSES = frozenset({TaskStatus.COMPLETED, TaskStatus.CANCELLED})
TASK_STATUS_SQL_VALUES = ", ".join(f"'{value}'" for value in TASK_STATUS_VALUES)
TASK_STATUS_CHECK_SQL = f"status IN ({TASK_STATUS_SQL_VALUES})"


def is_terminal_task_status(status: str | TaskStatus) -> bool:
    """Return whether a task has left the active-work lifecycle."""

    return TaskStatus(status) in TERMINAL_TASK_STATUSES
