"""Projects gain an autonomy policy and a default skill chain.

``autonomy`` says what a project does by itself once a task becomes ready
(manual, auto_start, auto_start_and_accept); ``default_skill_chain`` is the
JSON array of skill ids the policy runs on each one.

Revision ID: b7e2d4f6a1c8
Revises: a3d7f1c9e2b4
"""

from alembic import op
import sqlalchemy as sa

revision = "b7e2d4f6a1c8"
down_revision = "a3d7f1c9e2b4"
branch_labels = None
depends_on = None

_AUTONOMY_CHECK = "autonomy IN ('manual', 'auto_start', 'auto_start_and_accept')"


def _columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}


def upgrade() -> None:
    bind = op.get_bind()
    columns = _columns()
    if bind.dialect.name == "sqlite":
        # Added in place: rebuilding ``projects`` would drop the table and
        # fire SET NULL cascades from every project-scoped row (see the model).
        # The model validates the value; the CHECK waits for a rebuild that
        # happens for another reason.
        if "autonomy" not in columns:
            op.execute(
                "ALTER TABLE projects ADD COLUMN autonomy VARCHAR NOT NULL DEFAULT 'manual'"
            )
        if "default_skill_chain" not in columns:
            op.execute("ALTER TABLE projects ADD COLUMN default_skill_chain TEXT")
        return

    with op.batch_alter_table("projects") as batch_op:
        if "autonomy" not in columns:
            batch_op.add_column(
                sa.Column(
                    "autonomy", sa.String(), server_default="manual", nullable=False
                )
            )
        if "default_skill_chain" not in columns:
            batch_op.add_column(sa.Column("default_skill_chain", sa.Text(), nullable=True))
        batch_op.create_check_constraint("ck_projects_autonomy_valid", _AUTONOMY_CHECK)


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns()
    if bind.dialect.name == "sqlite":
        if "default_skill_chain" in columns:
            op.execute("ALTER TABLE projects DROP COLUMN default_skill_chain")
        if "autonomy" in columns:
            op.execute("ALTER TABLE projects DROP COLUMN autonomy")
        return

    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint("ck_projects_autonomy_valid", type_="check")
        if "default_skill_chain" in columns:
            batch_op.drop_column("default_skill_chain")
        if "autonomy" in columns:
            batch_op.drop_column("autonomy")
