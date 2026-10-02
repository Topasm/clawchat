import asyncio
import json
import sys
import textwrap
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import mcp_types as types
import pytest
from mcp import Client
from mcp.server.lowlevel import Server
from sqlalchemy import select

from domain.agent_run import AgentRunStatus
from domain.agent_tools import ToolCallStatus, ToolDecision, ToolTrust
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.agent_tools import AgentToolCall, AgentToolSettings, McpServer
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service
from services.tools import (
    agent_mcp_endpoint,
    approvals,
    catalog,
    cli_tool_args,
    gateway,
    mcp_client,
    searxng,
)
from services.tools.agent_turns import generate_skill_turn
from services.tools.tool_loop import AssistantTurn, ToolCallRequest


@pytest.fixture(autouse=True)
def silence_ws(monkeypatch):
    monkeypatch.setattr(agent_run_service, "ws_manager", SimpleNamespace(send_json=AsyncMock()))
    monkeypatch.setattr(approvals, "notify_module_data_changed", AsyncMock())


def _echo_server() -> Server:
    async def list_tools(_ctx, _params):
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name="echo",
                    description="Echo text back",
                    input_schema={
                        "type": "object",
                        "properties": {"text": {"type": "string"}},
                        "required": ["text"],
                    },
                )
            ]
        )

    async def call_tool(_ctx, params):
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"echo: {params.arguments['text']}")]
        )

    return Server("echo", on_list_tools=list_tools, on_call_tool=call_tool)


async def _run(db, *, status=AgentRunStatus.RUNNING, skill_chain=("research",)) -> AgentRun:
    project = Project(id="project_tools", title="Tools")
    db.add(project)
    await db.flush()
    todo = Todo(id="todo_tools", project_id=project.id, title="Look into pricing")
    db.add(todo)
    await db.flush()
    project.root_task_id = todo.id
    task = AgentTask(
        id="task_tools",
        task_type="research",
        instruction="Look into pricing",
        todo_id=todo.id,
        agent_type=skill_chain[0],
        skill_chain=json.dumps(list(skill_chain)),
    )
    db.add(task)
    await db.flush()
    run = await agent_run_service.create_run(db, task, provider="openclaw")
    run.status = status
    await db.commit()
    return run


async def _mcp_server_row(db, *, trust=ToolTrust.APPROVAL, name="notes") -> McpServer:
    server = McpServer(
        name=name,
        transport="http",
        url="http://127.0.0.1:1/mcp",
        trust=trust,
        tools_json=json.dumps(
            [{"name": "echo", "description": "Echo text back", "input_schema": {"type": "object"}}]
        ),
    )
    db.add(server)
    await db.commit()
    return server


# --- SearXNG ---------------------------------------------------------------


async def test_searxng_returns_titles_urls_and_snippets():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        assert request.url.params["format"] == "json"
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "Pricing", "url": "https://a.example/p", "content": "Plans from $5"},
                    {"title": "", "url": ""},
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        results = await searxng.search("http://searx.local/", "pricing", client=client)
    assert results == [
        {"title": "Pricing", "url": "https://a.example/p", "snippet": "Plans from $5"}
    ]
    assert "1. Pricing" in searxng.format_results("pricing", results)


async def test_searxng_explains_a_disabled_json_format():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _r: httpx.Response(403))
    ) as client:
        with pytest.raises(searxng.SearchError, match="search.formats"):
            await searxng.search("http://searx.local", "x", client=client)
    with pytest.raises(searxng.SearchError):
        searxng.normalize_base_url("ftp://searx.local")


# --- Catalog -----------------------------------------------------------------


async def test_research_gets_web_search_and_every_skill_gets_mcp_tools(db_session):
    assert await catalog.tools_for_skill(db_session, "research") == []
    db_session.add(AgentToolSettings(id="default", searxng_url="http://searx.local"))
    await _mcp_server_row(db_session, name="my-notes")

    research = [spec.name for spec in await catalog.tools_for_skill(db_session, "research")]
    draft = [spec.name for spec in await catalog.tools_for_skill(db_session, "draft")]

    assert research == ["web_search", "my-notes__echo"]
    assert draft == ["my-notes__echo"]


async def test_a_skill_file_can_limit_which_servers_and_tools_it_gets(db_session, monkeypatch):
    from skills import SKILL_REGISTRY, SkillDef

    def skill(skill_id, mcp_servers):
        return SkillDef(id=skill_id, name=skill_id, description="", system_prompt="x",
                        mcp_servers=mcp_servers)

    monkeypatch.setitem(SKILL_REGISTRY, "notes_only", skill("notes_only", ("notes",)))
    monkeypatch.setitem(SKILL_REGISTRY, "one_tool", skill("one_tool", ("other__echo",)))
    monkeypatch.setitem(SKILL_REGISTRY, "no_tools", skill("no_tools", ()))
    await _mcp_server_row(db_session, name="notes")
    await _mcp_server_row(db_session, name="other")

    async def names(skill_id):
        return [spec.name for spec in await catalog.tools_for_skill(db_session, skill_id)]

    assert await names("draft") == ["notes__echo", "other__echo"]
    assert await names("notes_only") == ["notes__echo"]
    assert await names("one_tool") == ["other__echo"]
    assert await names("no_tools") == []


async def test_chat_gets_web_search_and_only_servers_that_run_without_asking(db_session):
    assert await catalog.tools_for_chat(db_session) == []
    db_session.add(AgentToolSettings(id="default", searxng_url="http://searx.local"))
    await _mcp_server_row(db_session, name="asks", trust=ToolTrust.APPROVAL)
    await _mcp_server_row(db_session, name="reads", trust=ToolTrust.READ_ONLY)

    assert [s.name for s in await catalog.tools_for_chat(db_session)] == [
        "web_search",
        "reads__echo",
    ]


# --- Gateway and approvals -----------------------------------------------------


async def test_read_only_tools_run_at_once_and_are_recorded(db_session, monkeypatch):
    run = await _run(db_session)
    server = await _mcp_server_row(db_session, trust=ToolTrust.READ_ONLY)
    monkeypatch.setattr(
        mcp_client, "call_tool", AsyncMock(return_value=("echo: hi", False))
    )
    spec = catalog.server_specs(server)[0]

    text = await gateway.invoke(db_session, run_id=run.id, spec=spec, arguments={"text": "hi"})

    assert text == "echo: hi"
    call = (await db_session.execute(select(AgentToolCall))).scalar_one()
    assert (call.status, call.run_id, call.result_preview) == (
        ToolCallStatus.SUCCEEDED,
        run.id,
        "echo: hi",
    )


async def test_approval_pauses_the_run_until_the_user_allows(db_session, monkeypatch):
    run = await _run(db_session)
    run_id = run.id
    server = await _mcp_server_row(db_session)
    called = AsyncMock(return_value=("echo: hi", False))
    monkeypatch.setattr(mcp_client, "call_tool", called)
    spec = catalog.server_specs(server)[0]

    invocation = asyncio.ensure_future(
        gateway.invoke(db_session, run_id=run_id, spec=spec, arguments={"text": "hi"})
    )
    for _ in range(100):
        await asyncio.sleep(0.01)
        if approvals.pending_call_for_run(run_id):
            break
    call_id = approvals.pending_call_for_run(run_id)
    assert call_id and called.await_count == 0
    paused = await db_session.get(AgentRun, run_id)
    assert paused.status == AgentRunStatus.WAITING_INPUT
    response = await agent_run_service.build_run_response(db_session, paused)
    assert response.pending_tool_call.tool_name == "notes__echo"
    assert response.pending_tool_call.arguments == {"text": "hi"}

    approvals.decide(run_id, call_id, ToolDecision.ALLOW)
    assert await asyncio.wait_for(invocation, 2) == "echo: hi"
    assert (await db_session.get(AgentRun, run_id)).status == AgentRunStatus.RUNNING
    call = await db_session.get(AgentToolCall, call_id)
    assert call.status == ToolCallStatus.SUCCEEDED and call.decided_at is not None


async def test_a_denied_or_unanswered_call_never_runs(db_session, monkeypatch):
    run = await _run(db_session)
    run_id = run.id
    server = await _mcp_server_row(db_session)
    called = AsyncMock(return_value=("echo", False))
    monkeypatch.setattr(mcp_client, "call_tool", called)
    spec = catalog.server_specs(server)[0]

    invocation = asyncio.ensure_future(
        gateway.invoke(db_session, run_id=run_id, spec=spec, arguments={})
    )
    for _ in range(100):
        await asyncio.sleep(0.01)
        if approvals.pending_call_for_run(run_id):
            break
    approvals.decide(run_id, approvals.pending_call_for_run(run_id), ToolDecision.DENY)
    assert "did not allow" in await asyncio.wait_for(invocation, 2)

    monkeypatch.setattr(approvals, "APPROVAL_TIMEOUT_SECONDS", 0.05)
    original = approvals.request_decision

    async def quick(*args, **kwargs):
        return await original(*args, **{**kwargs, "timeout": 0.05})

    monkeypatch.setattr(approvals, "request_decision", quick)
    assert "did not allow" in await gateway.invoke(
        db_session, run_id=run_id, spec=spec, arguments={}
    )

    assert called.await_count == 0
    statuses = (await db_session.execute(select(AgentToolCall.status))).scalars().all()
    assert statuses == [ToolCallStatus.DENIED, ToolCallStatus.DENIED]
    with pytest.raises(Exception, match="no longer waiting"):
        approvals.decide(run_id, "tcall_missing", ToolDecision.ALLOW)


# --- API provider tool loop ----------------------------------------------------


class ToolCallingAI:
    model = "fake"
    supports_native_tool_calling = True

    def __init__(self):
        self.transcripts = []

    async def tool_turn(self, *, system_prompt, transcript, tools):
        self.transcripts.append(list(transcript))
        if not any(entry["role"] == "tool" for entry in transcript):
            return AssistantTurn(
                content=None,
                tool_calls=[ToolCallRequest("c1", "web_search", {"query": "pricing"})],
            )
        return AssistantTurn(content="Plans start at $5 (https://a.example/p).")


async def test_api_providers_loop_through_web_search(db_session, monkeypatch):
    run = await _run(db_session)
    db_session.add(AgentToolSettings(id="default", searxng_url="http://searx.local"))
    await db_session.commit()
    monkeypatch.setattr(
        searxng,
        "search",
        AsyncMock(return_value=[{"title": "P", "url": "https://a.example/p", "snippet": "$5"}]),
    )
    ai = ToolCallingAI()
    task = await db_session.get(AgentTask, run.agent_task_id)

    text, request = await generate_skill_turn(
        db_session, task, ai, skill_id="research",
        system_prompt="Research.", user_message="Pricing?",
    )

    assert (text, request) == ("Plans start at $5 (https://a.example/p).", None)
    tool_entry = ai.transcripts[1][-1]
    assert tool_entry["role"] == "tool" and "https://a.example/p" in tool_entry["content"]
    call = (await db_session.execute(select(AgentToolCall))).scalar_one()
    assert (call.tool_name, call.status) == ("web_search", ToolCallStatus.SUCCEEDED)


async def test_the_loop_can_still_ask_the_user(db_session):
    run = await _run(db_session)
    db_session.add(AgentToolSettings(id="default", searxng_url="http://searx.local"))
    await db_session.commit()

    class AskingAI(ToolCallingAI):
        async def tool_turn(self, *, system_prompt, transcript, tools):
            return AssistantTurn(
                content=None,
                tool_calls=[
                    ToolCallRequest("c1", "ask_user", {"question": "Which market?", "options": ["US", "EU"]})
                ],
            )

    task = await db_session.get(AgentTask, run.agent_task_id)
    text, request = await generate_skill_turn(
        db_session, task, AskingAI(), skill_id="research",
        system_prompt="Research.", user_message="Pricing?",
    )
    assert text is None and request.question == "Which market?" and request.options == ("US", "EU")


# --- MCP endpoint for CLI providers ---------------------------------------------


async def test_the_endpoint_offers_a_runs_tools_through_the_gateway(
    db_session, session_factory, monkeypatch
):
    run = await _run(db_session)
    server = await _mcp_server_row(db_session, trust=ToolTrust.READ_ONLY)
    monkeypatch.setattr(mcp_client, "call_tool", AsyncMock(return_value=("echo: hi", False)))
    specs = catalog.server_specs(server)

    async with agent_mcp_endpoint.run_scope(run.id, specs, session_factory) as access:
        assert agent_mcp_endpoint.current_cli_tools.get() is access
        marker = agent_mcp_endpoint._request_token.set(access.token)
        try:
            async with Client(agent_mcp_endpoint.build_server()) as client:
                listed = await client.list_tools()
                result = await client.call_tool("notes__echo", {"text": "hi"})
        finally:
            agent_mcp_endpoint._request_token.reset(marker)

    assert [tool.name for tool in listed.tools] == ["notes__echo"]
    assert result.content[0].text == "echo: hi"
    assert agent_mcp_endpoint.current_cli_tools.get() is None
    assert not agent_mcp_endpoint._scopes
    async with session_factory() as db:
        call = (await db.execute(select(AgentToolCall))).scalar_one()
    assert call.run_id == run.id


async def test_the_endpoint_rejects_unknown_tokens():
    app = agent_mcp_endpoint.asgi_app()
    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 5000))
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
        response = await client.post(
            agent_mcp_endpoint.PATH, headers={"Authorization": "Bearer nope"}, json={}
        )
    assert response.status_code == 401


# --- MCP client -------------------------------------------------------------------


async def test_the_client_lists_and_calls_an_in_process_server():
    server = _echo_server()
    tools = await mcp_client.list_tools(server)
    assert [(tool.name, tool.description) for tool in tools] == [("echo", "Echo text back")]
    assert await mcp_client.call_tool(server, "echo", {"text": "hi"}) == ("echo: hi", False)


async def test_the_client_starts_a_stdio_server(tmp_path):
    script = tmp_path / "server.py"
    script.write_text(
        textwrap.dedent(
            """
            from mcp.server.mcpserver import MCPServer

            server = MCPServer("stdio-demo")

            @server.tool()
            def shout(text: str) -> str:
                \"\"\"Upper-case the text.\"\"\"
                return text.upper()

            server.run()
            """
        )
    )
    row = McpServer(name="demo", transport="stdio", command=sys.executable, args_json=json.dumps([str(script)]))
    tools = await mcp_client.list_tools(row)
    assert [tool.name for tool in tools] == ["shout"]
    text, is_error = await mcp_client.call_tool(row, "shout", {"text": "hi"})
    assert (text, is_error) == ("HI", False)


async def test_an_unreachable_server_fails_softly():
    row = McpServer(name="gone", transport="stdio", command="/nonexistent/mcp-server")
    with pytest.raises(mcp_client.McpError, match="Could not connect"):
        await mcp_client.list_tools(row)


# --- CLI providers ------------------------------------------------------------------


async def test_claude_code_gets_only_clawchats_tools(monkeypatch):
    from services.ai import claude_code_provider as module

    captured = {}

    def fake_run(cmd, timeout=120, env=None):
        captured["cmd"], captured["timeout"], captured["env"] = cmd, timeout, env
        return SimpleNamespace(returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(module, "_run_cli_sync", fake_run)
    provider = module.ClaudeCodeProvider()
    provider._cli_path = "/usr/bin/claude"

    await provider.generate_completion("system", "task")
    assert captured["cmd"][captured["cmd"].index("--max-turns") + 1] == "1"
    assert "--mcp-config" not in captured["cmd"]

    access = agent_mcp_endpoint.CliToolAccess(url="http://127.0.0.1:8000/x", token="tok")
    marker = agent_mcp_endpoint.current_cli_tools.set(access)
    try:
        await provider.generate_completion("system", "task")
    finally:
        agent_mcp_endpoint.current_cli_tools.reset(marker)
    cmd = captured["cmd"]
    assert cmd[cmd.index("--tools") + 1] == ""
    assert "--strict-mcp-config" in cmd
    config = json.loads(cmd[cmd.index("--mcp-config") + 1])["mcpServers"]["clawchat"]
    assert config == {
        "type": "http",
        "url": "http://127.0.0.1:8000/x",
        "headers": {"Authorization": "Bearer tok"},
    }
    assert cmd[cmd.index("--allowedTools") + 1] == "mcp__clawchat"
    assert captured["timeout"] == cli_tool_args.TOOL_TURN_TIMEOUT_SECONDS
    # A call held for approval must not time out in the CLI first.
    assert int(captured["env"]["MCP_TOOL_TIMEOUT"]) > approvals.APPROVAL_TIMEOUT_SECONDS * 1000


async def test_codex_gets_the_endpoint_and_the_token_by_environment(monkeypatch, tmp_path):
    from services.ai import codex_cli_provider as module

    captured = {}

    def fake_run(cmd, *, input_text=None, timeout=180, cwd=None, env=None):
        captured.update(cmd=cmd, env=env, timeout=timeout)
        return SimpleNamespace(returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(module, "_run", fake_run)
    provider = module.CodexCLIProvider()
    monkeypatch.setattr(provider, "_cli_path", "/usr/bin/codex", raising=False)
    monkeypatch.setattr(provider, "_working_directory", tmp_path, raising=False)
    access = agent_mcp_endpoint.CliToolAccess(url="http://127.0.0.1:8000/x", token="s3cr3t-run-token")
    marker = agent_mcp_endpoint.current_cli_tools.set(access)
    try:
        await provider.generate_completion("system", "task")
    finally:
        agent_mcp_endpoint.current_cli_tools.reset(marker)
    cmd = captured["cmd"]
    assert 'mcp_servers.clawchat.url="http://127.0.0.1:8000/x"' in cmd
    assert f'mcp_servers.clawchat.bearer_token_env_var="{cli_tool_args.TOKEN_ENV}"' in cmd
    assert cmd.index("exec") > cmd.index('mcp_servers.clawchat.url="http://127.0.0.1:8000/x"')
    assert "s3cr3t-run-token" not in " ".join(cmd)
    timeout_flag = next(arg for arg in cmd if arg.startswith("mcp_servers.clawchat.tool_timeout_sec="))
    assert int(timeout_flag.split("=")[1]) > approvals.APPROVAL_TIMEOUT_SECONDS
    assert captured["env"][cli_tool_args.TOKEN_ENV] == "s3cr3t-run-token"
    # Codex's own MCP approval gate must be off: the run is unattended and
    # ClawChat already holds approval-required calls at its endpoint.
    assert 'mcp_servers.clawchat.default_tools_approval_mode="approve"' in cmd


# --- Management API -----------------------------------------------------------------


async def test_settings_and_servers_api_keeps_secrets_write_only(
    client, auth_headers, monkeypatch
):
    monkeypatch.setattr(
        mcp_client,
        "list_tools",
        AsyncMock(return_value=[mcp_client.RemoteTool("echo", "Echo text back", {"type": "object"})]),
    )
    bad = await client.put(
        "/api/agent-tools/settings", headers=auth_headers, json={"searxng_url": "searx.local"}
    )
    assert bad.status_code == 400
    ok = await client.put(
        "/api/agent-tools/settings",
        headers=auth_headers,
        json={"searxng_url": "http://searx.local:8888/"},
    )
    assert ok.json() == {"searxng_url": "http://searx.local:8888"}

    created = await client.post(
        "/api/agent-tools/mcp-servers",
        headers=auth_headers,
        json={
            "name": "notes",
            "transport": "http",
            "url": "https://mcp.example/mcp",
            "headers": {"Authorization": "Bearer secret"},
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["header_keys"] == ["Authorization"] and "secret" not in created.text
    assert body["trust"] == "approval" and body["tools"] == [
        {"name": "echo", "description": "Echo text back"}
    ]

    duplicate = await client.post(
        "/api/agent-tools/mcp-servers",
        headers=auth_headers,
        json={"name": "notes", "transport": "http", "url": "https://x.example/mcp"},
    )
    assert duplicate.status_code == 409

    patched = await client.patch(
        f"/api/agent-tools/mcp-servers/{body['id']}",
        headers=auth_headers,
        json={"headers": {"Authorization": None, "X-Team": "a"}, "trust": "read_only"},
    )
    assert patched.json()["header_keys"] == ["Authorization", "X-Team"]
    assert patched.json()["trust"] == "read_only"


async def test_decisions_need_a_waiting_request(client, auth_headers, db_session):
    run = await _run(db_session, status=AgentRunStatus.WAITING_INPUT)
    response = await client.post(
        f"/api/runs/{run.id}/tool-calls/tcall_x/decision",
        headers=auth_headers,
        json={"decision": "allow"},
    )
    assert response.status_code == 409
    listed = await client.get(f"/api/runs/{run.id}/tool-calls", headers=auth_headers)
    assert listed.json() == {"calls": []}


# --- End to end through the skill executor ----------------------------------------


async def test_a_research_run_records_its_searches(db_session, session_factory, monkeypatch):
    run = await _run(db_session, status=AgentRunStatus.QUEUED)
    run_id = run.id
    db_session.add(AgentToolSettings(id="default", searxng_url="http://searx.local"))
    await db_session.commit()
    monkeypatch.setattr(
        searxng,
        "search",
        AsyncMock(return_value=[{"title": "P", "url": "https://a.example/p", "snippet": "$5"}]),
    )
    task = await db_session.get(AgentTask, run.agent_task_id)

    await agent_task_service.execute_task(
        db_session, task, ToolCallingAI(), SimpleNamespace(send_json=AsyncMock()), "user",
        session_factory=session_factory, run=run, provider="openclaw",
    )

    db_session.expire_all()
    finished = await db_session.get(AgentRun, run_id)
    assert finished.status == AgentRunStatus.WAITING_REVIEW
    assert "https://a.example/p" in finished.result
    calls = (await db_session.execute(select(AgentToolCall))).scalars().all()
    assert [(c.tool_name, c.run_id) for c in calls] == [("web_search", run_id)]


async def test_a_follow_up_cannot_skip_a_pending_approval(db_session, monkeypatch):
    from exceptions import ConflictError
    from services.agents import run_resume_service

    run = await _run(db_session, status=AgentRunStatus.WAITING_INPUT)
    monkeypatch.setattr(approvals, "pending_call_for_run", lambda run_id: "tcall_waiting")
    task = await db_session.get(AgentTask, run.agent_task_id)
    with pytest.raises(ConflictError, match="Allow or deny"):
        await run_resume_service.resume_with_follow_up(
            db_session, SimpleNamespace(), run, task, "go ahead", user_id="user"
        )


async def test_restart_closes_approvals_nothing_waits_for(db_session):
    from services.tools.tool_admin_service import expire_abandoned_approvals

    run = await _run(db_session)
    db_session.add(
        AgentToolCall(run_id=run.id, tool_name="notes__echo", status=ToolCallStatus.PENDING_APPROVAL)
    )
    await db_session.commit()
    assert await expire_abandoned_approvals(db_session) == 1
    db_session.expire_all()
    call = (await db_session.execute(select(AgentToolCall))).scalar_one()
    assert call.status == ToolCallStatus.DENIED


async def test_a_finished_cli_turn_leaves_nothing_waiting(db_session, monkeypatch):
    run = await _run(db_session)
    run_id = run.id
    server = await _mcp_server_row(db_session)
    spec = catalog.server_specs(server)[0]
    called = AsyncMock(return_value=("echo", False))
    monkeypatch.setattr(mcp_client, "call_tool", called)
    invocation = asyncio.ensure_future(
        gateway.invoke(db_session, run_id=run_id, spec=spec, arguments={})
    )
    for _ in range(100):
        await asyncio.sleep(0.01)
        if approvals.pending_call_for_run(run_id):
            break

    approvals.cancel_for_run(run_id)

    assert "did not allow" in await asyncio.wait_for(invocation, 2)
    assert called.await_count == 0 and approvals.pending_call_for_run(run_id) is None
