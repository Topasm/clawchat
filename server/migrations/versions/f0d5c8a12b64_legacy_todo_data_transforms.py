"""normalize legacy todo status and assignee skill defaults

These two transforms used to run on every startup from
``database._run_data_migrations``, which meant a column could only be repaired
by editing the runtime path. They are one-shot data migrations, so they belong
in the revision history instead.

``c5e936c9d7b1`` already normalizes statuses for databases that are stamped
below it. Pre-Alembic databases are stamped at the revision their schema
matches, which is usually above ``c5e936c9d7b1``, so the normalization is
repeated here to reach them. It is idempotent either way.

Revision ID: f0d5c8a12b64
Revises: e2b7c4d81a35
Create Date: 2026-08-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f0d5c8a12b64"
down_revision: Union[str, Sequence[str], None] = "e2b7c4d81a35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VALID_STATUS_SQL = "'pending', 'in_progress', 'completed', 'cancelled'"

_ASSIGNEE_SKILL_DEFAULTS = (
    ("planner", '["plan"]'),
    ("researcher", '["research"]'),
    ("executor", '["obsidian_sync"]'),
)


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE todos SET status = 'pending', completed_at = NULL "
            f"WHERE status IS NULL OR status NOT IN ({_VALID_STATUS_SQL})"
        )
    )
    bind = op.get_bind()
    for assignee, skills in _ASSIGNEE_SKILL_DEFAULTS:
        bind.execute(
            sa.text(
                "UPDATE todos SET enabled_skills = :skills "
                "WHERE assignee = :assignee AND enabled_skills IS NULL"
            ),
            {"skills": skills, "assignee": assignee},
        )


def downgrade() -> None:
    """Restore the pre-migration NULL for the skill defaults this added.

    Only rows that still carry the exact default are cleared, so a skill chain
    a user edited after the upgrade survives the downgrade. The status
    normalization is not reversible: the original ad-hoc values were discarded
    by design, and ``c5e936c9d7b1`` makes the same trade.
    """
    bind = op.get_bind()
    for assignee, skills in _ASSIGNEE_SKILL_DEFAULTS:
        bind.execute(
            sa.text(
                "UPDATE todos SET enabled_skills = NULL "
                "WHERE assignee = :assignee AND enabled_skills = :skills"
            ),
            {"skills": skills, "assignee": assignee},
        )
