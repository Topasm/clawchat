"""Command-line additions that connect a CLI run to ClawChat's tool endpoint."""

import json
import os

from services.tools.agent_mcp_endpoint import CliToolAccess
from services.tools.approvals import APPROVAL_TIMEOUT_SECONDS

# A turn with tools may search, read, and wait for the user to approve a call.
TOOL_TURN_TIMEOUT_SECONDS = int(APPROVAL_TIMEOUT_SECONDS + 15 * 60)
CLAUDE_TOOL_MAX_TURNS = 16
TOKEN_ENV = "CLAWCHAT_AGENT_TOOLS_TOKEN"


def claude_args(access: CliToolAccess) -> list[str]:
    """Only ClawChat's tools: no built-in tools, none of the user's own MCP servers."""
    config = {
        "mcpServers": {
            access.server_name: {
                "type": "http",
                "url": access.url,
                "headers": {"Authorization": f"Bearer {access.token}"},
            }
        }
    }
    return [
        "--strict-mcp-config",
        "--tools",
        "",
        "--mcp-config",
        json.dumps(config),
        "--allowedTools",
        f"mcp__{access.server_name}",
    ]


def codex_args(access: CliToolAccess) -> list[str]:
    name = access.server_name
    return [
        "-c",
        f'mcp_servers.{name}.url="{access.url}"',
        "-c",
        f'mcp_servers.{name}.bearer_token_env_var="{TOKEN_ENV}"',
    ]


def codex_env(access: CliToolAccess) -> dict[str, str]:
    # The token travels in the environment, not on the command line.
    return {**os.environ, TOKEN_ENV: access.token}
