"""Close plan reviews left behind by tasks that are done, deleted or now notes.

Revision ID: b7d2e4f19a63
Revises: b7e3d1a9c425
"""

from alembic import op

revision = "b7d2e4f19a63"
down_revision = "b7e3d1a9c425"
branch_labels = None
depends_on = None

_SETTLED_PROPOSALS = """
    SELECT p.id FROM plan_proposals p
    LEFT JOIN todos t ON t.id = p.root_task_id
    WHERE p.status IN ('draft', 'stale')
      AND (t.id IS NULL OR t.status IN ('completed', 'cancelled'))
"""


def upgrade():
    op.execute(
        f"""
        UPDATE review_items
        SET status = 'expired', reviewed_at = CURRENT_TIMESTAMP
        WHERE subject_type = 'plan_proposal'
          AND status = 'pending'
          AND subject_id IN ({_SETTLED_PROPOSALS})
        """
    )
    op.execute(f"UPDATE plan_proposals SET status = 'stale' WHERE id IN ({_SETTLED_PROPOSALS})")


def downgrade():
    # Expired reviews stay expired: the tasks they asked about are gone or done.
    pass
