from typing import Any

from pydantic import BaseModel, Field

from domain.agent_tools import McpTransport, ToolDecision, ToolTrust
from schemas._utc import UtcDatetime

SERVER_NAME_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,39}$"


class AgentToolSettingsResponse(BaseModel):
    searxng_url: str | None


class AgentToolSettingsUpdate(BaseModel):
    searxng_url: str | None = Field(default=None, max_length=500)


class SearxngTestRequest(BaseModel):
    url: str = Field(min_length=1, max_length=500)


class SearxngTestResponse(BaseModel):
    ok: bool
    result_count: int = 0
    error: str | None = None


class McpToolInfo(BaseModel):
    name: str
    description: str


class McpServerResponse(BaseModel):
    id: str
    name: str
    transport: McpTransport
    command: str | None
    args: list[str]
    # Secrets never come back; the keys show what is set.
    env_keys: list[str]
    url: str | None
    header_keys: list[str]
    trust: ToolTrust
    enabled: bool
    tools: list[McpToolInfo]
    tools_refreshed_at: UtcDatetime | None
    last_error: str | None


class McpServerListResponse(BaseModel):
    servers: list[McpServerResponse]


class McpServerCreate(BaseModel):
    name: str = Field(pattern=SERVER_NAME_PATTERN)
    transport: McpTransport
    command: str | None = Field(default=None, max_length=1_000)
    args: list[str] = Field(default_factory=list, max_length=50)
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = Field(default=None, max_length=1_000)
    headers: dict[str, str] = Field(default_factory=dict)
    trust: ToolTrust = ToolTrust.APPROVAL
    enabled: bool = True


class McpServerUpdate(BaseModel):
    name: str | None = Field(default=None, pattern=SERVER_NAME_PATTERN)
    command: str | None = Field(default=None, max_length=1_000)
    args: list[str] | None = Field(default=None, max_length=50)
    # A key mapped to null keeps its stored value; keys left out are removed.
    env: dict[str, str | None] | None = None
    url: str | None = Field(default=None, max_length=1_000)
    headers: dict[str, str | None] | None = None
    trust: ToolTrust | None = None
    enabled: bool | None = None


class ToolCallResponse(BaseModel):
    id: str
    run_id: str | None
    tool_name: str
    arguments: dict[str, Any]
    status: str
    result_preview: str | None
    error: str | None
    created_at: UtcDatetime
    decided_at: UtcDatetime | None
    completed_at: UtcDatetime | None


class ToolCallListResponse(BaseModel):
    calls: list[ToolCallResponse]


class ToolCallDecisionRequest(BaseModel):
    decision: ToolDecision
