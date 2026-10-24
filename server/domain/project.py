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


class ProjectAutonomy(StrEnum):
    """How much a project does by itself once a task is ready.

    ``manual`` keeps every start behind a click. ``auto_start`` starts each
    newly ready leaf task with the project's default skill chain and parks
    every result in Review. ``auto_start_and_accept`` also adopts results the
    run could not have used to change anything (risk ``low`` or
    ``read_only_tools``); anything riskier still waits for a person.
    """

    MANUAL = "manual"
    AUTO_START = "auto_start"
    AUTO_START_AND_ACCEPT = "auto_start_and_accept"


PROJECT_AUTONOMY_VALUES = tuple(level.value for level in ProjectAutonomy)
PROJECT_AUTONOMY_CHECK_SQL = "autonomy IN (" + ", ".join(
    f"'{level}'" for level in PROJECT_AUTONOMY_VALUES
) + ")"
