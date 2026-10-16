"""Remember what the AI said about calendar titles the rules miss.

Revision ID: b7d3f1a9c605
Revises: b7d2e4f19a63
"""

from alembic import op
import sqlalchemy as sa

revision = "b7d3f1a9c605"
down_revision = "b7d2e4f19a63"
branch_labels = None
depends_on = None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("event_kind_guesses"):
        op.create_table(
            "event_kind_guesses",
            sa.Column("subject_key", sa.Text(), primary_key=True),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade():
    op.drop_table("event_kind_guesses")
