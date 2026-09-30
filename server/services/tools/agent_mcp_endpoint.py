"""ClawChat's own MCP endpoint, for runs executed by the Claude Code / Codex CLIs.

Those CLIs run their own tool loop, so ClawChat hands each run a URL and a
bearer token that lists exactly the tools that run was offered. Every call
goes through the same gateway as the API providers' loop: recorded, and held
for approval when the tool's server requires it.
"""

import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import mcp_types as types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import JSONResponse

from config import settings
from services.tools import gateway
from services.tools.catalog import ToolSpec

PATH = "/api/agent-tools/mcp"
SERVER_NAME = "clawchat"


@dataclass(frozen=True)
class RunToolScope:
    run_id: str
    specs: dict[str, ToolSpec]
    session_factory: Any


@dataclass(frozen=True)
class CliToolAccess:
    """What a CLI provider needs to connect a run to its tools."""

    url: str
    token: str
    server_name: str = SERVER_NAME


_scopes: dict[str, RunToolScope] = {}
# Set by the ASGI wrapper once the bearer token checks out (and by tests that
# talk to the server in process).
_request_token: ContextVar[str | None] = ContextVar("agent_tools_request_token", default=None)
# Read by the CLI providers while they build a run's command line.
current_cli_tools: ContextVar[CliToolAccess | None] = ContextVar(
    "current_cli_tools", default=None
)


def endpoint_url() -> str:
    return f"http://127.0.0.1:{settings.port}{PATH}"


@asynccontextmanager
async def run_scope(
    run_id: str, specs: list[ToolSpec], session_factory: Any
) -> AsyncIterator[CliToolAccess]:
    """Expose ``specs`` to the CLI for the duration of one agent turn."""
    token = secrets.token_urlsafe(32)
    _scopes[token] = RunToolScope(run_id, {spec.name: spec for spec in specs}, session_factory)
    access = CliToolAccess(url=endpoint_url(), token=token)
    marker = current_cli_tools.set(access)
    try:
        yield access
    finally:
        current_cli_tools.reset(marker)
        _scopes.pop(token, None)


def _scope() -> RunToolScope:
    token = _request_token.get()
    scope = _scopes.get(token or "")
    if scope is None:
        raise PermissionError("This tool session has ended")
    return scope


async def _list_tools(_ctx, _params) -> types.ListToolsResult:
    scope = _scope()
    return types.ListToolsResult(
        tools=[
            types.Tool(
                name=spec.name,
                description=spec.description,
                input_schema=spec.input_schema or {"type": "object"},
            )
            for spec in scope.specs.values()
        ]
    )


async def _call_tool(_ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    scope = _scope()
    spec = scope.specs.get(params.name)
    if spec is None:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"There is no tool named {params.name}.")],
            is_error=True,
        )
    async with scope.session_factory() as db:
        text = await gateway.invoke(
            db, run_id=scope.run_id, spec=spec, arguments=dict(params.arguments or {})
        )
    return types.CallToolResult(content=[types.TextContent(type="text", text=text)])


def build_server() -> Server:
    return Server(SERVER_NAME, on_list_tools=_list_tools, on_call_tool=_call_tool)


@asynccontextmanager
async def serve() -> AsyncIterator[None]:
    """Run the endpoint's session manager for the app's lifetime."""
    manager = StreamableHTTPSessionManager(
        app=build_server(),
        stateless=True,
        json_response=True,
        security_settings=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"],
            allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
        ),
    )
    async with manager.run():
        _app.manager = manager
        try:
            yield
        finally:
            _app.manager = None


class _AgentToolsApp:
    """ASGI endpoint: check the run's bearer token, then speak MCP."""

    manager: StreamableHTTPSessionManager | None = None

    async def __call__(self, scope, receive, send) -> None:
        headers = dict(scope.get("headers") or [])
        authorization = headers.get(b"authorization", b"").decode("latin-1")
        token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        client = (scope.get("client") or ("",))[0]
        if token not in _scopes or client not in ("127.0.0.1", "::1", "localhost"):
            await JSONResponse({"error": "unauthorized"}, status_code=401)(scope, receive, send)
            return
        if self.manager is None:
            await JSONResponse({"error": "unavailable"}, status_code=503)(scope, receive, send)
            return
        marker = _request_token.set(token)
        try:
            await self.manager.handle_request(scope, receive, send)
        finally:
            _request_token.reset(marker)


_app = _AgentToolsApp()


def asgi_app() -> _AgentToolsApp:
    return _app
