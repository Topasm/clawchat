"""The one place agent tool calls go through, whichever provider made them.

Every call is recorded. Tools from servers the user marked as needing approval
wait for an explicit allow before they run. Failures come back as text so the
model can adjust instead of the run failing.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from domain.agent_tools import ToolCallStatus, ToolDecision, ToolTrust
from models.agent_tools import AgentToolCall, McpServer
from services.tools import approvals, mcp_client, searxng
from services.tools.catalog import WEB_SEARCH, ToolSpec, get_settings
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_PREVIEW_CHARS = 2_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _execute(db: AsyncSession, spec: ToolSpec, arguments: dict[str, Any]) -> tuple[str, bool]:
    if spec.name == WEB_SEARCH and spec.server_id is None:
        settings = await get_settings(db)
        if not settings.searxng_url:
            return "Web search is not configured on this server.", True
        query = str(arguments.get("query") or "")
        try:
            results = await searxng.search(settings.searxng_url, query)
        except searxng.SearchError as exc:
            return f"Web search failed: {exc}", True
        return searxng.format_results(query, results), False

    server = await db.get(McpServer, spec.server_id) if spec.server_id else None
    if server is None or not server.enabled:
        return f"The tool {spec.name} is no longer available.", True
    try:
        return await mcp_client.call_tool(server, spec.remote_name or spec.name, arguments)
    except mcp_client.McpError as exc:
        return f"{spec.name} failed: {exc}", True


async def invoke(
    db: AsyncSession,
    *,
    run_id: str | None,
    spec: ToolSpec,
    arguments: dict[str, Any],
) -> str:
    """Run one tool call for ``run_id`` and return what the model should see."""
    if not isinstance(arguments, dict):
        arguments = {}
    call = AgentToolCall(
        run_id=run_id,
        server_id=spec.server_id,
        tool_name=spec.name,
        arguments_json=json.dumps(arguments, ensure_ascii=False),
        status=(
            ToolCallStatus.PENDING_APPROVAL
            if spec.trust == ToolTrust.APPROVAL
            else ToolCallStatus.RUNNING
        ),
    )
    db.add(call)
    await db.commit()

    if spec.trust == ToolTrust.APPROVAL:
        if run_id is None:
            decision = ToolDecision.DENY
        else:
            decision = await approvals.request_decision(
                db, run_id=run_id, call_id=call.id, tool_name=spec.name, arguments=arguments
            )
        call.decided_at = _now()
        if decision != ToolDecision.ALLOW:
            call.status = ToolCallStatus.DENIED
            call.completed_at = _now()
            await db.commit()
            return (
                f"The user did not allow {spec.name}. Do not retry it; continue "
                "without it or explain what you would need."
            )
        call.status = ToolCallStatus.RUNNING
        await db.commit()

    try:
        text, is_error = await _execute(db, spec, arguments)
    except Exception as exc:  # a broken tool must not take the run down
        logger.exception("Tool %s crashed", spec.name)
        text, is_error = f"{spec.name} failed unexpectedly: {exc.__class__.__name__}", True
    call.status = ToolCallStatus.FAILED if is_error else ToolCallStatus.SUCCEEDED
    call.result_preview = text[:_PREVIEW_CHARS]
    call.error = text[:_PREVIEW_CHARS] if is_error else None
    call.completed_at = _now()
    await db.commit()
    return text
