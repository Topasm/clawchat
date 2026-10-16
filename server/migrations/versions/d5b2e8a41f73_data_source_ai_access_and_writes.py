"""Device data sources: AI access and approved writes.

A source gains two switches, both off: whether chat and agents may read it,
and whether it takes changes at all. A change is recorded as a request that
waits for approval in review, so the request log and the review queue learn
one new operation, one new status and one new subject.

Revision ID: d5b2e8a41f73
Revises: b7e2c4a9d153
"""

from alembic import op
import sqlalchemy as sa

revision = "d5b2e8a41f73"
down_revision = "b7e2c4a9d153"
branch_labels = None
depends_on = None

_QUERY_STATUS = "status IN ('awaiting_approval', 'queued', 'claimed', 'done', 'failed', 'denied', 'expired')"
_QUERY_OP = "op IN ('list', 'read', 'search', 'append_todo')"
_OLD_QUERY_STATUS = "status IN ('queued', 'claimed', 'done', 'failed', 'denied', 'expired')"
_OLD_QUERY_OP = "op IN ('list', 'read', 'search')"
_SUBJECTS = (
    "plan_proposal", "artifact_revision", "agent_run", "code_diff",
    "schedule_change", "sync_conflict",
)


def _subject_check(subjects) -> str:
    return "subject_type IN (" + ", ".join(f"'{value}'" for value in subjects) + ")"


def _replace_checks(table: str, checks: dict[str, str]) -> None:
    # Nothing references these two tables, so rebuilding them cascades nowhere.
    with op.batch_alter_table(table, recreate="always") as batch_op:
        for name, condition in checks.items():
            batch_op.drop_constraint(name, type_="check")
            batch_op.create_check_constraint(name, condition)


def upgrade():
    # data_sources is referenced with ON DELETE CASCADE by its index and its
    # request log; rebuilding it would empty both, so the columns are added
    # in place.
    # A database built by ``create_all`` already has every column; adopting
    # it runs this revision too.
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("data_sources")}
    for name in ("ai_access", "allow_writes"):
        if name not in columns:
            op.add_column(
                "data_sources",
                sa.Column(name, sa.Boolean(), nullable=False, server_default="0"),
            )
    query_columns = {column["name"] for column in inspector.get_columns("data_source_queries")}
    if "approved_at" not in query_columns:
        op.add_column(
            "data_source_queries",
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        )
    _replace_checks(
        "data_source_queries",
        {
            "ck_data_source_queries_status_valid": _QUERY_STATUS,
            "ck_data_source_queries_op_valid": _QUERY_OP,
        },
    )
    _replace_checks(
        "review_items",
        {"ck_review_items_subject_type": _subject_check((*_SUBJECTS, "data_source_write"))},
    )


def downgrade():
    op.execute("DELETE FROM review_items WHERE subject_type = 'data_source_write'")
    _replace_checks("review_items", {"ck_review_items_subject_type": _subject_check(_SUBJECTS)})
    op.execute(
        "DELETE FROM data_source_queries "
        "WHERE op = 'append_todo' OR status = 'awaiting_approval'"
    )
    _replace_checks(
        "data_source_queries",
        {
            "ck_data_source_queries_status_valid": _OLD_QUERY_STATUS,
            "ck_data_source_queries_op_valid": _OLD_QUERY_OP,
        },
    )
    with op.batch_alter_table("data_source_queries", recreate="always") as batch_op:
        batch_op.drop_column("approved_at")
    op.drop_column("data_sources", "allow_writes")
    op.drop_column("data_sources", "ai_access")
