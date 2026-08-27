"""add first-class projects and project-scoped graph revisions

Revision ID: 1f6b9c4d2a70
Revises: 7a31c9e5d204
Create Date: 2026-08-27 23:00:00.000000

"""

from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "1f6b9c4d2a70"
down_revision: Union[str, Sequence[str], None] = "7a31c9e5d204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TRIGGER_NAMES = (
    "todos_bump_task_graph_revision_insert",
    "todos_bump_task_graph_revision_delete",
    "todos_bump_task_graph_revision_update",
    "task_relationships_bump_graph_revision_insert",
    "task_relationships_bump_graph_revision_update",
    "task_relationships_bump_graph_revision_delete",
)
_TODO_COLUMNS = (
    "project_id", "title", "description", "status", "priority", "due_date",
    "completed_at", "conversation_id", "message_id", "tags", "parent_id",
    "sort_order", "source", "source_id", "assignee", "enabled_skills",
    "estimated_minutes", "clarification_questions", "clarification_answers",
    "recurrence_rule", "recurrence_end", "recurrence_exceptions",
    "recurring_source_id",
)
_TODO_UPDATE_COLUMNS = ", ".join(_TODO_COLUMNS)
_TODO_CHANGED = " OR ".join(
    f"OLD.{column} IS NOT NEW.{column}" for column in _TODO_COLUMNS
)
_GLOBAL_BUMP = """
    UPDATE task_graph_states SET revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP WHERE scope_id = 'global';
"""


def _project_bump(expression: str) -> str:
    return f"""
        UPDATE projects SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP WHERE id = {expression};
    """


def _relationship_bump(prefix: str) -> str:
    return f"""
        UPDATE projects SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT project_id FROM todos
            WHERE id IN ({prefix}.source_task_id, {prefix}.target_task_id)
              AND project_id IS NOT NULL
        );
    """


_TRIGGERS = (
    f"""CREATE TRIGGER todos_bump_task_graph_revision_insert AFTER INSERT ON todos
    BEGIN {_GLOBAL_BUMP} {_project_bump('NEW.project_id')} END""",
    f"""CREATE TRIGGER todos_bump_task_graph_revision_delete AFTER DELETE ON todos
    BEGIN {_GLOBAL_BUMP} {_project_bump('OLD.project_id')} END""",
    f"""CREATE TRIGGER todos_bump_task_graph_revision_update
    AFTER UPDATE OF {_TODO_UPDATE_COLUMNS} ON todos WHEN {_TODO_CHANGED}
    BEGIN
        {_GLOBAL_BUMP}
        UPDATE projects SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (OLD.project_id, NEW.project_id);
    END""",
    f"""CREATE TRIGGER task_relationships_bump_graph_revision_insert
    AFTER INSERT ON task_relationships
    BEGIN {_GLOBAL_BUMP} {_relationship_bump('NEW')} END""",
    f"""CREATE TRIGGER task_relationships_bump_graph_revision_update
    AFTER UPDATE ON task_relationships
    BEGIN
        {_GLOBAL_BUMP}
        UPDATE projects SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT project_id FROM todos
            WHERE id IN (
                OLD.source_task_id, OLD.target_task_id,
                NEW.source_task_id, NEW.target_task_id
            ) AND project_id IS NOT NULL
        );
    END""",
    f"""CREATE TRIGGER task_relationships_bump_graph_revision_delete
    AFTER DELETE ON task_relationships
    BEGIN {_GLOBAL_BUMP} {_relationship_bump('OLD')} END""",
)


def _new_project_id() -> str:
    return f"project_{uuid.uuid4().hex[:12]}"


def _backfill(bind) -> None:
    todo_rows = list(bind.execute(sa.text(
        "SELECT id, title, description, status, due_date, parent_id, source, "
        "created_at, updated_at FROM todos ORDER BY created_at, id"
    )).mappings())
    conversation_rows = list(bind.execute(sa.text(
        "SELECT id, project_todo_id FROM conversations"
    )).mappings())
    linked_roots = {
        row["project_todo_id"] for row in conversation_rows
        if row["project_todo_id"] is not None
    }
    children: dict[str, list[str]] = defaultdict(list)
    by_id = {row["id"]: row for row in todo_rows}
    for row in todo_rows:
        if row["parent_id"] is not None:
            children[row["parent_id"]].append(row["id"])
    global_revision = bind.execute(sa.text(
        "SELECT revision FROM task_graph_states WHERE scope_id = 'global'"
    )).scalar_one_or_none() or 0
    now = datetime.now(timezone.utc)

    for root in todo_rows:
        if root["parent_id"] is not None:
            continue
        if not (children.get(root["id"]) or root["id"] in linked_roots or root["source"]):
            continue
        project_id = _new_project_id()
        bind.execute(sa.text("""
            INSERT INTO projects (
                id, title, goal, description, status, deadline, root_task_id,
                graph_revision, default_execution_provider, created_at, updated_at
            ) VALUES (
                :id, :title, NULL, :description, :status, :deadline, :root_task_id,
                :graph_revision, NULL, :created_at, :updated_at
            )
        """), {
            "id": project_id,
            "title": root["title"],
            "description": root["description"],
            "status": "completed" if root["status"] == "completed" else "active",
            "deadline": root["due_date"],
            "root_task_id": root["id"],
            "graph_revision": global_revision,
            "created_at": root["created_at"] or now,
            "updated_at": root["updated_at"] or now,
        })
        queue = deque([root["id"]])
        while queue:
            todo_id = queue.popleft()
            bind.execute(
                sa.text("UPDATE todos SET project_id = :project_id WHERE id = :id"),
                {"project_id": project_id, "id": todo_id},
            )
            queue.extend(children.get(todo_id, ()))
        bind.execute(sa.text("""
            UPDATE conversations SET project_id = :project_id
            WHERE project_todo_id = :root_task_id
        """), {"project_id": project_id, "root_task_id": root["id"]})

    bind.execute(sa.text("""
        UPDATE events SET project_id = (
            SELECT conversations.project_id FROM conversations
            WHERE conversations.id = events.conversation_id
        )
        WHERE project_id IS NULL AND conversation_id IS NOT NULL
    """))
    bind.execute(sa.text("""
        UPDATE plan_proposals SET project_id = (
            SELECT todos.project_id FROM todos
            WHERE todos.id = plan_proposals.root_task_id
        )
        WHERE project_id IS NULL AND root_task_id IS NOT NULL
    """))


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        for name in _TRIGGER_NAMES:
            op.execute(f"DROP TRIGGER IF EXISTS {name}")

    op.create_table(
        "projects",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("root_task_id", sa.String(), nullable=True),
        sa.Column("graph_revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column("default_execution_provider", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('planned', 'active', 'completed', 'archived')",
            name="ck_projects_status_valid",
        ),
        sa.CheckConstraint(
            "graph_revision >= 0",
            name="ck_projects_graph_revision_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["root_task_id"], ["todos.id"],
            name="fk_projects_root_task_id", ondelete="SET NULL", use_alter=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_projects_status", "projects", ["status"])
    op.create_index("idx_projects_updated_at", "projects", ["updated_at"])
    op.create_index("uq_projects_root_task_id", "projects", ["root_task_id"], unique=True)

    additions = (
        ("todos", "project_id", "projects", "idx_todos_project_id"),
        ("conversations", "project_id", "projects", "idx_conversations_project_id"),
        ("events", "project_id", "projects", "idx_events_project_id"),
        ("plan_proposals", "project_id", "projects", None),
    )
    for table, column, target, index in additions:
        if bind.dialect.name == "sqlite":
            # Rebuilding ``todos`` would drop the old table and activate
            # cascading FKs from task_relationships. SQLite supports adding a
            # nullable REFERENCES column in place, which preserves every edge.
            op.execute(
                f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR "
                f"REFERENCES {target}(id) ON DELETE SET NULL"
            )
            if index:
                op.create_index(index, table, [column], unique=False)
        else:
            with op.batch_alter_table(table) as batch_op:
                batch_op.add_column(sa.Column(column, sa.String(), nullable=True))
                batch_op.create_foreign_key(
                    f"fk_{table}_{column}",
                    target,
                    [column],
                    ["id"],
                    ondelete="SET NULL",
                )
                if index:
                    batch_op.create_index(index, [column], unique=False)
    op.create_index(
        "idx_plan_proposals_project_status",
        "plan_proposals",
        ["project_id", "status"],
    )

    _backfill(bind)
    if bind.dialect.name == "sqlite":
        for statement in _TRIGGERS:
            op.execute(statement)


def downgrade() -> None:
    bind = op.get_bind()
    non_legacy = bind.execute(sa.text(
        "SELECT COUNT(*) FROM projects WHERE root_task_id IS NULL OR goal IS NOT NULL "
        "OR default_execution_provider IS NOT NULL"
    )).scalar_one()
    if non_legacy:
        raise RuntimeError(
            "Cannot downgrade without losing first-class project data"
        )
    if bind.dialect.name == "sqlite":
        for name in _TRIGGER_NAMES:
            op.execute(f"DROP TRIGGER IF EXISTS {name}")

    op.drop_index("idx_plan_proposals_project_status", table_name="plan_proposals")
    removals = (
        ("plan_proposals", "project_id", None),
        ("events", "project_id", "idx_events_project_id"),
        ("conversations", "project_id", "idx_conversations_project_id"),
        ("todos", "project_id", "idx_todos_project_id"),
    )
    for table, column, index in removals:
        if bind.dialect.name == "sqlite":
            if index:
                op.drop_index(index, table_name=table)
            op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        else:
            with op.batch_alter_table(table) as batch_op:
                if index:
                    batch_op.drop_index(index)
                batch_op.drop_constraint(
                    f"fk_{table}_{column}",
                    type_="foreignkey",
                )
                batch_op.drop_column(column)
    op.drop_index("uq_projects_root_task_id", table_name="projects")
    op.drop_index("idx_projects_updated_at", table_name="projects")
    op.drop_index("idx_projects_status", table_name="projects")
    op.drop_table("projects")
