from auth.dependencies import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, Response
from schemas.agent_tools import (
    AgentToolSettingsResponse,
    AgentToolSettingsUpdate,
    McpServerCreate,
    McpServerListResponse,
    McpServerResponse,
    McpServerUpdate,
    SearxngTestRequest,
    SearxngTestResponse,
    ToolCallDecisionRequest,
    ToolCallListResponse,
)
from services.agents import agent_run_service
from services.tools import approvals, tool_admin_service as tools
from services.tools.catalog import get_settings
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(dependencies=[Depends(get_current_user)])
runs_router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/settings", response_model=AgentToolSettingsResponse)
async def read_tool_settings(db: AsyncSession = Depends(get_db)):
    settings = await get_settings(db)
    await db.commit()
    return AgentToolSettingsResponse(searxng_url=settings.searxng_url)


@router.put("/settings", response_model=AgentToolSettingsResponse)
async def update_tool_settings(
    body: AgentToolSettingsUpdate, db: AsyncSession = Depends(get_db)
):
    return AgentToolSettingsResponse(
        searxng_url=await tools.set_searxng_url(db, body.searxng_url)
    )


@router.post("/searxng/test", response_model=SearxngTestResponse)
async def test_searxng(body: SearxngTestRequest):
    ok, count, error = await tools.test_searxng(body.url)
    return SearxngTestResponse(ok=ok, result_count=count, error=error)


@router.get("/mcp-servers", response_model=McpServerListResponse)
async def list_mcp_servers(db: AsyncSession = Depends(get_db)):
    return McpServerListResponse(
        servers=[tools.server_response(server) for server in await tools.list_servers(db)]
    )


@router.post("/mcp-servers", response_model=McpServerResponse, status_code=201)
async def create_mcp_server(body: McpServerCreate, db: AsyncSession = Depends(get_db)):
    return tools.server_response(await tools.create_server(db, body))


@router.patch("/mcp-servers/{server_id}", response_model=McpServerResponse)
async def update_mcp_server(
    server_id: str, body: McpServerUpdate, db: AsyncSession = Depends(get_db)
):
    return tools.server_response(await tools.update_server(db, server_id, body))


@router.delete("/mcp-servers/{server_id}", status_code=204)
async def delete_mcp_server(server_id: str, db: AsyncSession = Depends(get_db)):
    await tools.delete_server(db, server_id)
    return Response(status_code=204)


@router.post("/mcp-servers/{server_id}/refresh", response_model=McpServerResponse)
async def refresh_mcp_server(server_id: str, db: AsyncSession = Depends(get_db)):
    server = await tools.require_server(db, server_id)
    return tools.server_response(await tools.refresh_tools(db, server))


@runs_router.get("/{run_id}/tool-calls", response_model=ToolCallListResponse)
async def list_run_tool_calls(run_id: str, db: AsyncSession = Depends(get_db)):
    await agent_run_service.require_run(db, run_id)
    return ToolCallListResponse(
        calls=[tools.call_response(call) for call in await tools.calls_for_run(db, run_id)]
    )


@runs_router.post("/{run_id}/tool-calls/{call_id}/decision", status_code=204)
async def decide_tool_call(run_id: str, call_id: str, body: ToolCallDecisionRequest):
    approvals.decide(run_id, call_id, body.decision)
    return Response(status_code=204)
