"""Review risk gains read_only_tools: a read-only chain that only looked things up.

Revision ID: a3d7f1c9e2b4
Revises: d4e8a1b7c952
"""

from alembic import op
import sqlalchemy as sa

revision = "a3d7f1c9e2b4"
down_revision = "d4e8a1b7c952"
branch_labels = None
depends_on = None

_LEVELS = ("low", "read_only_tools", "medium", "high")
_OLD_LEVELS = ("low", "medium", "high")


def _check(levels) -> str:
    return "risk_level IN (" + ", ".join(f"'{value}'" for value in levels) + ")"


def _replace_check(levels) -> None:
    # Nothing references review_items, so rebuilding it cascades nowhere.
    with op.batch_alter_table("review_items", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_review_items_risk", type_="check")
        batch_op.create_check_constraint("ck_review_items_risk", _check(levels))


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("review_items"):
        return
    _replace_check(_LEVELS)


def downgrade():
    # The old schema has no word for "only looked things up"; asked about is the safe reading.
    op.execute("UPDATE review_items SET risk_level = 'medium' WHERE risk_level = 'read_only_tools'")
    _replace_check(_OLD_LEVELS)
