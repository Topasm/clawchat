"""Agent tools: MCP servers, tool settings, and the tool-call audit trail.

Revision ID: e5b8c2f7a913
Revises: c3e8f6a12b49
"""

from alembic import op
import sqlalchemy as sa

revision = "e5b8c2f7a913"
down_revision = "c3e8f6a12b49"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("mcp_servers"):
        op.create_table(
            "mcp_servers",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(40), nullable=False, unique=True),
            sa.Column("transport", sa.String(), nullable=False),
            sa.Column("command", sa.Text(), nullable=True),
            sa.Column("args_json", sa.Text(), nullable=False),
            sa.Column("env_json", sa.Text(), nullable=False),
            sa.Column("url", sa.Text(), nullable=True),
            sa.Column("headers_json", sa.Text(), nullable=False),
            sa.Column("trust", sa.String(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("tools_json", sa.Text(), nullable=False),
            sa.Column("tools_refreshed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if not inspector.has_table("agent_tool_settings"):
        op.create_table(
            "agent_tool_settings",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("searxng_url", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if not inspector.has_table("agent_tool_calls"):
        op.create_table(
            "agent_tool_calls",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "run_id",
                sa.String(),
                sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "server_id",
                sa.String(),
                sa.ForeignKey("mcp_servers.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("tool_name", sa.String(), nullable=False),
            sa.Column("arguments_json", sa.Text(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("result_preview", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_agent_tool_calls_run_id", "agent_tool_calls", ["run_id"])
        op.create_index("ix_agent_tool_calls_status", "agent_tool_calls", ["status"])


def downgrade():
    op.drop_table("agent_tool_calls")
    op.drop_table("agent_tool_settings")
    op.drop_table("mcp_servers")
