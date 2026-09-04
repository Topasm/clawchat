"""bind project workspaces to the host they exist on

A workspace path is only meaningful together with the machine holding it, so
`projects.execution_workspace_path` becomes a path recorded per host, plus the
one host a project runs on. Every existing path already referred to the machine
this server runs on, so it is backfilled onto a seeded local host in the same
transaction as the schema change: a half-applied version would leave configured
projects unrunnable.

The old column stays as a compatibility shadow, the way `todos.depends_on`
does, and is no longer the read model.

Revision ID: b2d7f4e91c58
Revises: a8f3c1d7e240
Create Date: 2026-09-03 02:40:00.000000
"""

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "b2d7f4e91c58"
down_revision: Union[str, Sequence[str], None] = "a8f3c1d7e240"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCAL_HOST_ID = "host_localserver00000001"
LOCAL_HOST_LABEL = "This server"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # A database adopted from ``create_all`` already carries these tables, and
    # adoption stamps before this revision. Creating them again would abort the
    # upgrade, so every object here is created only when it is missing.
    if not inspector.has_table("execution_hosts"):
        _create_execution_hosts()
    if not inspector.has_table("project_host_paths"):
        _create_project_host_paths()
    if "execution_host_id" not in {
        column["name"] for column in inspector.get_columns("projects")
    }:
        # SQLite cannot add a column with a foreign key in place, and rebuilding
        # projects would briefly drop it, firing SET NULL cascades from every
        # project-scoped row. The reference is enforced in the service layer.
        op.execute("ALTER TABLE projects ADD COLUMN execution_host_id VARCHAR")

    _backfill_local_host(bind)


def _create_execution_hosts() -> None:
    op.create_table(
        "execution_hosts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default="local"),
        sa.Column("target", sa.Text(), nullable=True),
        sa.Column("platform", sa.String(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('local', 'paseo', 'worker')",
            name="ck_execution_hosts_kind_valid",
        ),
        sa.UniqueConstraint("label", name="uq_execution_hosts_label"),
    )
    op.create_index(
        "idx_execution_hosts_is_enabled",
        "execution_hosts",
        ["is_enabled"],
    )


def _create_project_host_paths() -> None:
    op.create_table(
        "project_host_paths",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("host_id", sa.String(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["host_id"],
            ["execution_hosts.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "project_id",
            "host_id",
            name="uq_project_host_paths_project_host",
        ),
    )
    op.create_index(
        "idx_project_host_paths_project_id",
        "project_host_paths",
        ["project_id"],
    )


def _backfill_local_host(bind) -> None:
    """Move every configured path onto a seeded host for this machine."""
    if bind.execute(
        sa.text("SELECT 1 FROM execution_hosts WHERE id = :id"),
        {"id": LOCAL_HOST_ID},
    ).first():
        return

    configured = bind.execute(
        sa.text(
            "SELECT id, execution_workspace_path FROM projects "
            "WHERE execution_workspace_path IS NOT NULL "
            "AND TRIM(execution_workspace_path) <> ''"
        )
    ).fetchall()
    if not configured:
        return

    now = datetime.now(timezone.utc)
    bind.execute(
        sa.text(
            "INSERT INTO execution_hosts "
            "(id, label, kind, target, platform, is_enabled, created_at, updated_at) "
            "VALUES (:id, :label, 'local', NULL, NULL, 1, :now, :now)"
        ),
        {"id": LOCAL_HOST_ID, "label": LOCAL_HOST_LABEL, "now": now},
    )
    for project_id, path in configured:
        bind.execute(
            sa.text(
                "INSERT INTO project_host_paths "
                "(id, project_id, host_id, path, created_at, updated_at) "
                "VALUES (:id, :project_id, :host_id, :path, :now, :now)"
            ),
            {
                "id": f"hostpath_{uuid.uuid4().hex[:16]}",
                "project_id": project_id,
                "host_id": LOCAL_HOST_ID,
                "path": path,
                "now": now,
            },
        )
        bind.execute(
            sa.text("UPDATE projects SET execution_host_id = :host_id WHERE id = :id"),
            {"host_id": LOCAL_HOST_ID, "id": project_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # Batch mode would rebuild `projects`, and the task-graph triggers on
        # `todos` reference it by name: they break the moment it disappears,
        # even briefly. SQLite drops the column in place instead.
        op.execute("ALTER TABLE projects DROP COLUMN execution_host_id")
    else:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.drop_column("execution_host_id")
    op.drop_index(
        "idx_project_host_paths_project_id",
        table_name="project_host_paths",
    )
    op.drop_table("project_host_paths")
    op.drop_index("idx_execution_hosts_is_enabled", table_name="execution_hosts")
    op.drop_table("execution_hosts")
