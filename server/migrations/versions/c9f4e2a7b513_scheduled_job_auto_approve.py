"""Automations may skip review for low-risk results.

Revision ID: c9f4e2a7b513
Revises: b7d3f1a9c605
"""

from alembic import op
import sqlalchemy as sa

revision = "c9f4e2a7b513"
down_revision = "b7d3f1a9c605"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("scheduled_jobs"):
        return
    columns = {column["name"] for column in inspector.get_columns("scheduled_jobs")}
    if "auto_approve_low_risk" in columns:
        return
    with op.batch_alter_table("scheduled_jobs") as batch_op:
        batch_op.add_column(
            sa.Column(
                "auto_approve_low_risk",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade():
    with op.batch_alter_table("scheduled_jobs") as batch_op:
        batch_op.drop_column("auto_approve_low_risk")
