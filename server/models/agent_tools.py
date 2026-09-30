from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from domain.agent_tools import McpTransport, ToolCallStatus, ToolTrust
from utils import make_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


class McpServer(Base):
    """An MCP server the user added; its tools are offered to agent runs."""

    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("mcp_"))
    # Short, unique, and safe inside a tool name: the model sees "<name>__<tool>".
    name: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    transport: Mapped[str] = mapped_column(String, nullable=False)
    command: Mapped[str | None] = mapped_column(Text, nullable=True)
    args_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # Secrets live here as they do for the rest of a self-hosted database; the
    # API returns only their keys.
    env_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    headers_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    trust: Mapped[str] = mapped_column(String, nullable=False, default=ToolTrust.APPROVAL)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # The tools it offered when last listed: [{name, description, input_schema}].
    tools_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    tools_refreshed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    @validates("transport")
    def _validate_transport(self, _key: str, value: str) -> str:
        return McpTransport(value).value

    @validates("trust")
    def _validate_trust(self, _key: str, value: str) -> str:
        return ToolTrust(value).value


class AgentToolSettings(Base):
    """Host-wide tool settings (a single row)."""

    __tablename__ = "agent_tool_settings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default="default")
    searxng_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class AgentToolCall(Base):
    """One tool call an agent made or asked to make: the audit trail and the
    approval request in one row."""

    __tablename__ = "agent_tool_calls"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("tcall_"))
    run_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=True
    )
    server_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("mcp_servers.id", ondelete="SET NULL"), nullable=True
    )
    tool_name: Mapped[str] = mapped_column(String, nullable=False)
    arguments_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[str] = mapped_column(String, nullable=False)
    result_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_agent_tool_calls_run_id", "run_id"),
        Index("ix_agent_tool_calls_status", "status"),
    )

    @validates("status")
    def _validate_status(self, _key: str, value: str) -> str:
        return ToolCallStatus(value).value
