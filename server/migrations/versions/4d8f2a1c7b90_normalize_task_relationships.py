"""normalize task relationships

Revision ID: 4d8f2a1c7b90
Revises: c5e936c9d7b1
Create Date: 2026-08-27 20:00:00.000000

"""

import json
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4d8f2a1c7b90"
down_revision: Union[str, Sequence[str], None] = "c5e936c9d7b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEPENDS_ON = "depends_on"
_VALID_TYPES_SQL = "'depends_on', 'related', 'duplicate'"
_MIGRATION_MARKER = "normalized_task_relationships_v1"

_CYCLE_INSERT_TRIGGER = """
CREATE TRIGGER task_relationships_prevent_dependency_cycle_insert
BEFORE INSERT ON task_relationships
WHEN NEW.type = 'depends_on'
BEGIN
    WITH RECURSIVE reachable(task_id) AS (
        SELECT NEW.target_task_id
        UNION
        SELECT relationship.target_task_id
        FROM task_relationships AS relationship
        JOIN reachable
          ON relationship.source_task_id = reachable.task_id
        WHERE relationship.type = 'depends_on'
    )
    SELECT RAISE(ABORT, 'dependency cycle detected')
    WHERE EXISTS (
        SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
    );
END
"""

_CYCLE_UPDATE_TRIGGER = """
CREATE TRIGGER task_relationships_prevent_dependency_cycle_update
BEFORE UPDATE OF source_task_id, target_task_id, type ON task_relationships
WHEN NEW.type = 'depends_on'
BEGIN
    WITH RECURSIVE reachable(task_id) AS (
        SELECT NEW.target_task_id
        UNION
        SELECT relationship.target_task_id
        FROM task_relationships AS relationship
        JOIN reachable
          ON relationship.source_task_id = reachable.task_id
        WHERE relationship.type = 'depends_on'
          AND relationship.id <> OLD.id
    )
    SELECT RAISE(ABORT, 'dependency cycle detected')
    WHERE EXISTS (
        SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
    );
END
"""


def _legacy_dependency_edges(
    rows: list[tuple[str, str | None]],
) -> list[tuple[str, str]]:
    todo_ids = {todo_id for todo_id, _raw in rows}
    edges: list[tuple[str, str]] = []
    for todo_id, raw_dependencies in rows:
        if raw_dependencies is None or raw_dependencies == "":
            continue
        try:
            dependency_ids = json.loads(raw_dependencies)
        except (json.JSONDecodeError, TypeError) as exc:
            raise RuntimeError(
                f"Todo {todo_id} has malformed depends_on JSON"
            ) from exc
        if not isinstance(dependency_ids, list):
            raise RuntimeError(f"Todo {todo_id} depends_on must be a JSON array")
        if any(
            not isinstance(dependency_id, str) or not dependency_id
            for dependency_id in dependency_ids
        ):
            raise RuntimeError(
                f"Todo {todo_id} depends_on must contain non-empty task IDs"
            )
        if len(dependency_ids) != len(set(dependency_ids)):
            raise RuntimeError(f"Todo {todo_id} has duplicate dependencies")
        for dependency_id in dependency_ids:
            if dependency_id == todo_id:
                raise RuntimeError(f"Todo {todo_id} cannot depend on itself")
            if dependency_id not in todo_ids:
                raise RuntimeError(
                    f"Todo {todo_id} references missing dependency {dependency_id}"
                )
            edges.append((todo_id, dependency_id))
    return edges


def _validate_dependency_dag(edges: list[tuple[str, str]]) -> None:
    adjacency: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {}
    for source_task_id, target_task_id in edges:
        adjacency[source_task_id].append(target_task_id)
        in_degree.setdefault(source_task_id, 0)
        in_degree[target_task_id] = in_degree.get(target_task_id, 0) + 1

    ready = deque(
        task_id
        for task_id, degree in in_degree.items()
        if degree == 0
    )
    visited = 0
    while ready:
        task_id = ready.popleft()
        visited += 1
        for target_task_id in adjacency.get(task_id, []):
            in_degree[target_task_id] -= 1
            if in_degree[target_task_id] == 0:
                ready.append(target_task_id)

    if visited != len(in_degree):
        raise RuntimeError("Dependency cycle detected")


def upgrade() -> None:
    bind = op.get_bind()
    legacy_rows = [
        (row.id, row.depends_on)
        for row in bind.execute(
            sa.text("SELECT id, depends_on FROM todos ORDER BY created_at, id")
        )
    ]
    edges = _legacy_dependency_edges(legacy_rows)
    _validate_dependency_dag(edges)

    op.create_table(
        "data_migration_markers",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("name"),
    )
    op.create_table(
        "task_relationships",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("source_task_id", sa.String(), nullable=False),
        sa.Column("target_task_id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            sa.String(),
            server_default="user",
            nullable=False,
        ),
        sa.Column("proposal_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"type IN ({_VALID_TYPES_SQL})",
            name="ck_task_relationships_type_valid",
        ),
        sa.CheckConstraint(
            "source_task_id <> target_task_id",
            name="ck_task_relationships_not_self",
        ),
        sa.ForeignKeyConstraint(
            ["source_task_id"],
            ["todos.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_task_id"],
            ["todos.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_task_id",
            "target_task_id",
            "type",
            name="uq_task_relationships_source_target_type",
        ),
    )
    op.create_index(
        "idx_task_relationships_source_type",
        "task_relationships",
        ["source_task_id", "type"],
        unique=False,
    )
    op.create_index(
        "idx_task_relationships_target_type",
        "task_relationships",
        ["target_task_id", "type"],
        unique=False,
    )
    op.create_index(
        "idx_task_relationships_proposal_id",
        "task_relationships",
        ["proposal_id"],
        unique=False,
    )
    op.execute(_CYCLE_INSERT_TRIGGER)
    op.execute(_CYCLE_UPDATE_TRIGGER)

    if edges:
        relationship_table = sa.table(
            "task_relationships",
            sa.column("id", sa.String()),
            sa.column("source_task_id", sa.String()),
            sa.column("target_task_id", sa.String()),
            sa.column("type", sa.String()),
            sa.column("label", sa.Text()),
            sa.column("created_by", sa.String()),
            sa.column("proposal_id", sa.String()),
            sa.column("created_at", sa.DateTime(timezone=True)),
            sa.column("updated_at", sa.DateTime(timezone=True)),
        )
        base_time = datetime.now(timezone.utc)
        op.bulk_insert(
            relationship_table,
            [
                {
                    "id": f"rel_{uuid.uuid4().hex[:12]}",
                    "source_task_id": source_task_id,
                    "target_task_id": target_task_id,
                    "type": _DEPENDS_ON,
                    "label": None,
                    "created_by": "legacy",
                    "proposal_id": None,
                    "created_at": base_time + timedelta(microseconds=index),
                    "updated_at": base_time + timedelta(microseconds=index),
                }
                for index, (source_task_id, target_task_id) in enumerate(edges)
            ],
        )

    marker_table = sa.table(
        "data_migration_markers",
        sa.column("name", sa.String()),
        sa.column("completed_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        marker_table,
        [
            {
                "name": _MIGRATION_MARKER,
                "completed_at": datetime.now(timezone.utc),
            }
        ],
    )


def downgrade() -> None:
    bind = op.get_bind()
    rows = list(
        bind.execute(
            sa.text(
                "SELECT id, source_task_id, target_task_id, type, label, "
                "created_by, proposal_id "
                "FROM task_relationships ORDER BY created_at, id"
            )
        )
    )
    unsupported_types = sorted({row.type for row in rows if row.type != _DEPENDS_ON})
    if unsupported_types:
        raise RuntimeError(
            "Cannot downgrade task_relationships without losing relationship types: "
            + ", ".join(unsupported_types)
        )
    metadata_rows = [
        row.id
        for row in rows
        if row.created_by != "legacy"
        or row.label is not None
        or row.proposal_id is not None
    ]
    if metadata_rows:
        raise RuntimeError(
            "Cannot downgrade task_relationships without losing provenance "
            "or metadata for relationship(s): "
            + ", ".join(metadata_rows)
        )

    dependencies_by_source: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        dependencies_by_source[row.source_task_id].append(row.target_task_id)

    bind.execute(sa.text("UPDATE todos SET depends_on = NULL"))
    for source_task_id, dependency_ids in dependencies_by_source.items():
        bind.execute(
            sa.text("UPDATE todos SET depends_on = :depends_on WHERE id = :todo_id"),
            {
                "depends_on": json.dumps(dependency_ids),
                "todo_id": source_task_id,
            },
        )

    op.drop_index(
        "idx_task_relationships_proposal_id",
        table_name="task_relationships",
    )
    op.execute(
        "DROP TRIGGER IF EXISTS "
        "task_relationships_prevent_dependency_cycle_update"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS "
        "task_relationships_prevent_dependency_cycle_insert"
    )
    op.drop_index(
        "idx_task_relationships_target_type",
        table_name="task_relationships",
    )
    op.drop_index(
        "idx_task_relationships_source_type",
        table_name="task_relationships",
    )
    op.drop_table("task_relationships")
    op.drop_table("data_migration_markers")
