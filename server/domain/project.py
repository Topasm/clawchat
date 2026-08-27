"""Canonical project lifecycle values."""

from enum import StrEnum


class ProjectStatus(StrEnum):
    PLANNED = "planned"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


PROJECT_STATUS_VALUES = tuple(status.value for status in ProjectStatus)
PROJECT_STATUS_CHECK_SQL = "status IN (" + ", ".join(
    f"'{status}'" for status in PROJECT_STATUS_VALUES
) + ")"
