"""Managing the tools agents may use: SearXNG and the user's MCP servers."""

import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlsplit

from domain.agent_tools import McpTransport, ToolCallStatus
from exceptions import ConflictError, NotFoundError, ValidationError
from models.agent_tools import AgentToolCall, McpServer
from schemas.agent_tools import (
    McpServerCreate,
    McpServerResponse,
    McpServerUpdate,
    McpToolInfo,
    ToolCallResponse,
)
from services.tools import mcp_client, searxng
from services.tools.catalog import get_settings
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def set_searxng_url(db: AsyncSession, url: str | None) -> str | None:
    settings = await get_settings(db)
    if url is None or not url.strip():
        settings.searxng_url = None
    else:
        try:
            settings.searxng_url = searxng.normalize_base_url(url)
        except searxng.SearchError as exc:
            raise ValidationError(str(exc)) from exc
    await db.commit()
    return settings.searxng_url


async def test_searxng(url: str) -> tuple[bool, int, str | None]:
    try:
        results = await searxng.search(url, "ClawChat")
    except searxng.SearchError as exc:
        return False, 0, str(exc)
    return True, len(results), None


def server_response(server: McpServer) -> McpServerResponse:
    return McpServerResponse(
        id=server.id,
        name=server.name,
        transport=McpTransport(server.transport),
        command=server.command,
        args=json.loads(server.args_json or "[]"),
        env_keys=sorted(json.loads(server.env_json or "{}")),
        url=server.url,
        header_keys=sorted(json.loads(server.headers_json or "{}")),
        trust=server.trust,
        enabled=server.enabled,
        tools=[
            McpToolInfo(name=tool["name"], description=tool.get("description") or "")
            for tool in json.loads(server.tools_json or "[]")
        ],
        tools_refreshed_at=_utc(server.tools_refreshed_at),
        last_error=server.last_error,
    )


def _check_target(transport: McpTransport, command: str | None, url: str | None) -> None:
    if transport == McpTransport.STDIO and not (command or "").strip():
        raise ValidationError("A stdio server needs the command that starts it")
    if transport == McpTransport.HTTP:
        parts = urlsplit((url or "").strip())
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValidationError("An HTTP server needs its MCP endpoint URL")


def _merge_secrets(stored_json: str, incoming: dict[str, str | None]) -> str:
    stored = json.loads(stored_json or "{}")
    merged = {}
    for key, value in incoming.items():
        if value is None:
            if key in stored:
                merged[key] = stored[key]
        else:
            merged[key] = value
    return json.dumps(merged)


async def require_server(db: AsyncSession, server_id: str) -> McpServer:
    server = await db.get(McpServer, server_id)
    if server is None:
        raise NotFoundError("MCP server not found")
    return server


async def list_servers(db: AsyncSession) -> list[McpServer]:
    return list((await db.execute(select(McpServer).order_by(McpServer.name))).scalars())


async def refresh_tools(db: AsyncSession, server: McpServer) -> McpServer:
    """List the server's tools now; a failure is recorded, not raised."""
    try:
        tools = await mcp_client.list_tools(server)
    except mcp_client.McpError as exc:
        server.last_error = str(exc)
    else:
        server.tools_json = json.dumps(
            [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }
                for tool in tools
            ]
        )
        server.tools_refreshed_at = datetime.now(timezone.utc)
        server.last_error = None
    await db.commit()
    return server


async def _commit_unique(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("Another MCP server already uses that name") from exc


async def create_server(db: AsyncSession, body: McpServerCreate) -> McpServer:
    _check_target(body.transport, body.command, body.url)
    server = McpServer(
        name=body.name,
        transport=body.transport,
        command=(body.command or "").strip() or None,
        args_json=json.dumps(body.args),
        env_json=json.dumps(body.env),
        url=(body.url or "").strip() or None,
        headers_json=json.dumps(body.headers),
        trust=body.trust,
        enabled=body.enabled,
    )
    db.add(server)
    await _commit_unique(db)
    return await refresh_tools(db, server)


async def update_server(db: AsyncSession, server_id: str, body: McpServerUpdate) -> McpServer:
    server = await require_server(db, server_id)
    fields = body.model_fields_set
    reconnect = False
    if "name" in fields and body.name is not None:
        server.name = body.name
    if "command" in fields:
        server.command = (body.command or "").strip() or None
        reconnect = True
    if "args" in fields and body.args is not None:
        server.args_json = json.dumps(body.args)
        reconnect = True
    if "env" in fields and body.env is not None:
        server.env_json = _merge_secrets(server.env_json, body.env)
        reconnect = True
    if "url" in fields:
        server.url = (body.url or "").strip() or None
        reconnect = True
    if "headers" in fields and body.headers is not None:
        server.headers_json = _merge_secrets(server.headers_json, body.headers)
        reconnect = True
    if "trust" in fields and body.trust is not None:
        server.trust = body.trust
    if "enabled" in fields and body.enabled is not None:
        server.enabled = body.enabled
        reconnect = reconnect or body.enabled
    _check_target(McpTransport(server.transport), server.command, server.url)
    await _commit_unique(db)
    if reconnect and server.enabled:
        await refresh_tools(db, server)
    return server


async def delete_server(db: AsyncSession, server_id: str) -> None:
    await db.delete(await require_server(db, server_id))
    await db.commit()


def call_response(call: AgentToolCall) -> ToolCallResponse:
    try:
        arguments = json.loads(call.arguments_json or "{}")
    except json.JSONDecodeError:
        arguments = {}
    return ToolCallResponse(
        id=call.id,
        run_id=call.run_id,
        tool_name=call.tool_name,
        arguments=arguments if isinstance(arguments, dict) else {},
        status=call.status,
        result_preview=call.result_preview,
        error=call.error,
        created_at=_utc(call.created_at),
        decided_at=_utc(call.decided_at),
        completed_at=_utc(call.completed_at),
    )


async def calls_for_run(db: AsyncSession, run_id: str) -> list[AgentToolCall]:
    return list(
        (
            await db.execute(
                select(AgentToolCall)
                .where(AgentToolCall.run_id == run_id)
                .order_by(AgentToolCall.created_at)
            )
        ).scalars()
    )


async def expire_abandoned_approvals(db: AsyncSession) -> int:
    """Approvals nothing is waiting for anymore (the server restarted) are denied."""
    result = await db.execute(
        update(AgentToolCall)
        .where(AgentToolCall.status == ToolCallStatus.PENDING_APPROVAL)
        .values(
            status=ToolCallStatus.DENIED,
            error="The server restarted before this call was decided",
            completed_at=datetime.now(timezone.utc),
        )
    )
    await db.commit()
    return result.rowcount or 0
