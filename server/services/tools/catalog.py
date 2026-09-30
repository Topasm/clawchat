"""Which tools an agent turn is offered, and how the model sees them."""

import json
import re
from dataclasses import dataclass, field
from typing import Any

from domain.agent_tools import ToolTrust
from models.agent_tools import AgentToolSettings, McpServer
from skills import SKILL_REGISTRY
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

WEB_SEARCH = "web_search"
_NAME_UNSAFE = re.compile(r"[^A-Za-z0-9_-]+")
# Function names are limited to 64 characters by the model APIs.
_MAX_NAME = 64

WEB_SEARCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "What to search the web for."}
    },
    "required": ["query"],
}


@dataclass(frozen=True)
class ToolSpec:
    """One tool as offered to the model."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(hash=False)
    trust: ToolTrust
    # None for tools ClawChat implements itself (web_search).
    server_id: str | None = None
    remote_name: str | None = None

    def as_function(self) -> dict[str, Any]:
        """OpenAI-style function definition."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description[:1_000],
                "parameters": self.input_schema or {"type": "object"},
            },
        }


def tool_name(server_name: str, remote_name: str) -> str:
    """The name the model calls, e.g. ``files__read_file``."""
    name = _NAME_UNSAFE.sub("_", f"{server_name}__{remote_name}")
    return name[:_MAX_NAME]


async def get_settings(db: AsyncSession) -> AgentToolSettings:
    settings = await db.get(AgentToolSettings, "default")
    if settings is None:
        settings = AgentToolSettings(id="default")
        db.add(settings)
        await db.flush()
    return settings


def web_search_spec() -> ToolSpec:
    return ToolSpec(
        name=WEB_SEARCH,
        description=(
            "Search the web through the user's SearXNG instance. Returns titles, "
            "URLs, and snippets. Use it for current or external facts, and cite "
            "the URLs you rely on."
        ),
        input_schema=WEB_SEARCH_SCHEMA,
        trust=ToolTrust.READ_ONLY,
    )


def server_specs(server: McpServer) -> list[ToolSpec]:
    specs = []
    for tool in json.loads(server.tools_json or "[]"):
        specs.append(
            ToolSpec(
                name=tool_name(server.name, tool["name"]),
                description=f"[{server.name}] {tool.get('description') or tool['name']}",
                input_schema=tool.get("input_schema") or {"type": "object"},
                trust=ToolTrust(server.trust),
                server_id=server.id,
                remote_name=tool["name"],
            )
        )
    return specs


async def tools_for_skill(db: AsyncSession, skill_id: str) -> list[ToolSpec]:
    """Web search for skills that research; the user's MCP tools for every skill."""
    specs: list[ToolSpec] = []
    skill = SKILL_REGISTRY.get(skill_id)
    settings = await db.get(AgentToolSettings, "default")
    if skill is not None and skill.uses_web_search and settings and settings.searxng_url:
        specs.append(web_search_spec())
    servers = (
        await db.execute(
            select(McpServer).where(McpServer.enabled.is_(True)).order_by(McpServer.name)
        )
    ).scalars()
    seen = {spec.name for spec in specs}
    for server in servers:
        for spec in server_specs(server):
            if spec.name not in seen:
                seen.add(spec.name)
                specs.append(spec)
    return specs
