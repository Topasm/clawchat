"""Canonical task relationship domain values."""

from enum import StrEnum


class TaskRelationshipType(StrEnum):
    """Persisted edge types shared by task graph clients."""

    DEPENDS_ON = "depends_on"
    RELATED = "related"
    DUPLICATE = "duplicate"


TASK_RELATIONSHIP_TYPE_VALUES = tuple(
    relationship_type.value for relationship_type in TaskRelationshipType
)
TASK_RELATIONSHIP_TYPE_SQL_VALUES = ", ".join(
    f"'{value}'" for value in TASK_RELATIONSHIP_TYPE_VALUES
)
TASK_RELATIONSHIP_TYPE_CHECK_SQL = (
    f"type IN ({TASK_RELATIONSHIP_TYPE_SQL_VALUES})"
)
TASK_RELATIONSHIP_MIGRATION_MARKER = "normalized_task_relationships_v1"
