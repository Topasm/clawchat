"""enforce the canonical task status on databases that cannot take the CHECK

``c5e936c9d7b1`` adds ``ck_todos_status_valid`` to ``todos``.  SQLite can only
express a new CHECK constraint by rebuilding the table, and a pre-Alembic
database is stamped *past* that revision (its probe in ``database.py`` is
deliberately aliased to the baseline probe), so those installations never get
the constraint.  Until now their only guard was the ORM ``@validates`` hook,
which any raw SQL write bypasses.

Rebuilding ``todos`` here to close the gap is not an option.  ``todos`` is
referenced by ``task_relationships`` (ON DELETE CASCADE), ``attachments``
(CASCADE), ``artifacts``, ``plan_proposals``, ``agent_tasks``,
``conversations``, and twice by ``todos`` itself (SET NULL).  ``database.py``
registers a global ``connect`` listener that turns ``PRAGMA foreign_keys=ON``
for every engine in the process, Alembic's included, so the ``DROP TABLE todos``
inside a rebuild fires every one of those actions.  Measured on SQLite 3.50:

* ``PRAGMA foreign_keys=OFF`` is a documented no-op inside a transaction, and
  Alembic runs each migration inside one -- the pragma reports back ``1`` and
  the cascade still runs.  It fails *silently*.
* ``PRAGMA defer_foreign_keys=ON`` is settable inside a transaction but only
  defers violation *reporting*; the cascade actions still run.
* Only disabling enforcement before the transaction opens works, which a
  revision cannot do without tearing down Alembic's own transaction.

So this revision enforces the same domain with triggers instead.  Triggers need
no table rewrite, so nothing referencing ``todos`` is touched.  Fresh databases
already have the CHECK and get the triggers too, which keeps enforcement
identical everywhere rather than conditional on a database's age.

Note for future revisions: a batch/rebuild migration on ``todos`` drops these
triggers along with the table.  Any such revision must recreate them (or add
the real CHECK constraint, which a rebuild can finally do).

Revision ID: a3f1c72b8d94
Revises: f0d5c8a12b64
Create Date: 2026-08-29 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "a3f1c72b8d94"
down_revision: Union[str, Sequence[str], None] = "f0d5c8a12b64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VALID_STATUS_SQL = "'pending', 'in_progress', 'completed', 'cancelled'"

# The abort message repeats the constraint name so a failure reads the same
# whether it came from the CHECK (fresh database) or from the trigger (adopted
# one), and so tests can match on one string.
_ABORT = "RAISE(ABORT, 'ck_todos_status_valid: invalid task status')"

_INSERT_TRIGGER = f"""
CREATE TRIGGER IF NOT EXISTS ck_todos_status_valid_insert
BEFORE INSERT ON todos
WHEN NEW.status IS NULL OR NEW.status NOT IN ({_VALID_STATUS_SQL})
BEGIN
    SELECT {_ABORT};
END
"""

_UPDATE_TRIGGER = f"""
CREATE TRIGGER IF NOT EXISTS ck_todos_status_valid_update
BEFORE UPDATE OF status ON todos
WHEN NEW.status IS NULL OR NEW.status NOT IN ({_VALID_STATUS_SQL})
BEGIN
    SELECT {_ABORT};
END
"""

_TRIGGER_NAMES = (
    "ck_todos_status_valid_insert",
    "ck_todos_status_valid_update",
)


def upgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        # Every other backend takes the CHECK constraint from c5e936c9d7b1
        # directly; the triggers exist only to work around SQLite's inability
        # to add one in place.
        return
    # Repeat the idempotent normalisation so no row is left in a state the
    # triggers would then refuse to update.
    op.execute(
        "UPDATE todos SET status = 'pending', completed_at = NULL "
        f"WHERE status IS NULL OR status NOT IN ({_VALID_STATUS_SQL})"
    )
    op.execute(_INSERT_TRIGGER)
    op.execute(_UPDATE_TRIGGER)


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        return
    for name in _TRIGGER_NAMES:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")
