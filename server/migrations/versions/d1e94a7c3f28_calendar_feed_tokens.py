"""add revocable tokens for subscribable calendar feeds

``GET /api/events/export.ics`` required an ``Authorization`` header, which no
external calendar client can send, so the feed could never actually be
subscribed to. The new ``/api/events/feed/{token}.ics`` route authenticates from
the URL instead, and this table is the server-side state behind that token.

The shape deliberately mirrors ``refresh_sessions``: a random URL-safe secret is
minted in the application, only its SHA-256 hash is stored, and revocation is a
timestamp rather than a delete so the history of which feed was live survives a
reissue. ``token_hash`` is uniquely indexed both to make lookup cheap and to
make a duplicated hash impossible to insert.

Adoption note -- why this revision checks before it creates
-----------------------------------------------------------
``database._LEGACY_REVISION_PROBES`` recognises a pre-Alembic database by its
schema shape and stamps it at the matching revision. Every entry in that list
names a table (or column) that the pre-Alembic ``create_all`` startup path
produced, and every previous table-creating revision has one. This revision
does not: ``database.py`` is not modified here, so an adopted database is
stamped no higher than ``e2b7c4d81a35`` and then upgraded through this
revision.

For a database that really predates Alembic that is correct -- it was built by
a ``create_all`` from a release where this table did not exist, so creating it
now is exactly right. But ``tests/test_legacy_startup_migration.py`` simulates
that database with *today's* ``Base.metadata.create_all``, which does declare
``calendar_feed_tokens``, so a plain ``op.create_table`` collides there.

Rather than depend on a probe this file cannot add, the upgrade is idempotent:
if the table is already present the revision is a no-op. That is safe because
the table is created here in exactly the shape the ORM declares -- the parity
tests in ``tests/test_schema_migration_parity.py`` fail otherwise -- so an
already-present table is by construction the right one.

Revision ID: d1e94a7c3f28
Revises: a3f1c72b8d94
Create Date: 2026-08-29 15:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1e94a7c3f28"
down_revision: Union[str, Sequence[str], None] = "a3f1c72b8d94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "calendar_feed_tokens"


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table(_TABLE):
        # Already materialised by a create_all that ran ahead of the stamp.
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revocation_reason", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_calendar_feed_tokens_subject",
        _TABLE,
        ["subject"],
    )
    op.create_index(
        "idx_calendar_feed_tokens_token_hash",
        _TABLE,
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    """Drop the table, which revokes every issued feed URL.

    That is the correct outcome: without this table no feed token can be
    verified, so downgrading leaves no credential still granting calendar
    access. Bearer-authenticated ``/api/events/export.ics`` keeps working.
    """
    if not sa.inspect(op.get_bind()).has_table(_TABLE):
        return
    op.drop_index("idx_calendar_feed_tokens_token_hash", table_name=_TABLE)
    op.drop_index("idx_calendar_feed_tokens_subject", table_name=_TABLE)
    op.drop_table(_TABLE)
