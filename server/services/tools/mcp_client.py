"""Talk to the MCP servers the user added.

Each call opens its own connection and closes it afterwards. That costs a
process start for stdio servers, but a run holds no connection open while it
waits for the user to approve a call, and a server that crashes only fails the
call that hit it.
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx2
from mcp import Client, StdioServerParameters
from mcp.client.streamable_http import streamable_http_client

from domain.agent_tools import McpTransport
from models.agent_tools import McpServer

CONNECT_TIMEOUT_SECONDS = 30.0
CALL_TIMEOUT_SECONDS = 120.0
MAX_RESULT_CHARS = 20_000
MAX_TOOLS_PER_SERVER = 64


class McpError(Exception):
    """The server could not be reached or the call failed; safe to show."""


@dataclass(frozen=True)
class RemoteTool:
    name: str
    description: str
    input_schema: dict[str, Any]


def _server_target(server: McpServer):
    if server.transport == McpTransport.STDIO:
        if not server.command:
            raise McpError("This server has no command to start")
        env = json.loads(server.env_json or "{}")
        # A stdio server inherits PATH and friends so `npx`/`uvx` resolve, plus
        # whatever the user configured for it.
        return StdioServerParameters(
            command=server.command,
            args=json.loads(server.args_json or "[]"),
            env={**os.environ, **env} if env else None,
        )
    if not server.url:
        raise McpError("This server has no URL")
    headers = json.loads(server.headers_json or "{}")
    return streamable_http_client(
        server.url,
        http_client=httpx2.AsyncClient(headers=headers, timeout=CALL_TIMEOUT_SECONDS),
    )


@asynccontextmanager
async def connect(server: McpServer | Any):
    """Yield a connected client. ``server`` may also be an in-process Server (tests)."""
    target = server if not isinstance(server, McpServer) else _server_target(server)
    try:
        async with asyncio.timeout(CONNECT_TIMEOUT_SECONDS):
            client = Client(target, read_timeout_seconds=CALL_TIMEOUT_SECONDS)
            await client.__aenter__()
    except McpError:
        raise
    except (Exception, TimeoutError) as exc:
        raise McpError(f"Could not connect: {_describe(exc)}") from exc
    try:
        yield client
    finally:
        try:
            await client.__aexit__(None, None, None)
        except Exception:
            pass


def _describe(exc: BaseException) -> str:
    if isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        return _describe(exc.exceptions[0])
    text = str(exc).strip()
    return f"{exc.__class__.__name__}: {text}" if text else exc.__class__.__name__


async def list_tools(server: McpServer | Any) -> list[RemoteTool]:
    async with connect(server) as client:
        try:
            result = await client.list_tools()
        except Exception as exc:
            raise McpError(f"Could not list tools: {_describe(exc)}") from exc
    tools = []
    for tool in result.tools[:MAX_TOOLS_PER_SERVER]:
        tools.append(
            RemoteTool(
                name=tool.name,
                description=(tool.description or "").strip(),
                input_schema=dict(tool.input_schema or {"type": "object"}),
            )
        )
    return tools


def _result_text(result: Any) -> str:
    parts = []
    for block in result.content or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
        else:
            parts.append(f"[{getattr(block, 'type', 'content')} omitted]")
    if not parts and result.structured_content is not None:
        parts.append(json.dumps(result.structured_content, ensure_ascii=False))
    text = "\n".join(parts).strip() or "(no output)"
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + "\n…(truncated)"
    return text


async def call_tool(
    server: McpServer | Any, tool_name: str, arguments: dict[str, Any]
) -> tuple[str, bool]:
    """Call one tool; return (text, is_error)."""
    async with connect(server) as client:
        try:
            result = await client.call_tool(tool_name, arguments)
        except Exception as exc:
            raise McpError(f"The tool call failed: {_describe(exc)}") from exc
    return _result_text(result), bool(getattr(result, "is_error", False))
