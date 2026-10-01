"""Chat replies that use the user's read-only tools, over SSE and WebSocket."""

import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from domain.agent_tools import ToolCallStatus, ToolTrust
from models.agent_tools import AgentToolCall, McpServer
from services.chat.chat_tools import TOOLS_HINT, reply_events
from services.tools import mcp_client
from services.tools.agent_mcp_endpoint import current_cli_tools
from services.tools.tool_loop import AssistantTurn, ToolCallRequest

MESSAGES = [
    {"role": "system", "content": "You are ClawChat."},
    {"role": "user", "content": "hi"},
    {"role": "assistant", "content": "hello"},
    {"role": "user", "content": "What did I note about pricing?"},
]


async def _read_only_server(db, name="notes") -> McpServer:
    server = McpServer(
        name=name,
        transport="http",
        url="http://127.0.0.1:1/mcp",
        trust=ToolTrust.READ_ONLY,
        tools_json=json.dumps(
            [{"name": "search", "description": "Search notes", "input_schema": {"type": "object"}}]
        ),
    )
    db.add(server)
    await db.commit()
    return server


class LoopingAI:
    """Calls notes__search once, then answers from the result."""

    supports_native_tool_calling = True

    def __init__(self):
        self.turns = []

    async def tool_turn(self, *, system_prompt, transcript, tools):
        self.turns.append((system_prompt, list(transcript), tools))
        if not any(entry["role"] == "tool" for entry in transcript):
            return AssistantTurn(
                content=None,
                tool_calls=[ToolCallRequest("c1", "notes__search", {"q": "pricing"})],
            )
        found = next(e["content"] for e in transcript if e["role"] == "tool")
        return AssistantTurn(content=f"You noted: {found}")

    async def stream_completion(self, messages):
        raise AssertionError("a tool-capable provider must run the loop")


class CliAI:
    """No native tool calling: the tools reach it through ClawChat's endpoint."""

    supports_native_tool_calling = False

    def __init__(self):
        self.seen_messages = None
        self.scoped = None

    async def stream_completion(self, messages):
        self.seen_messages = messages
        self.scoped = current_cli_tools.get()
        yield "Plain "
        yield "answer"


async def _collect(session_factory, ai, messages=MESSAGES):
    return [event async for event in reply_events(session_factory, ai, messages)]


async def test_without_tools_the_reply_streams_as_before(session_factory):
    ai = CliAI()
    events = await _collect(session_factory, ai)
    assert [(e.kind, e.text) for e in events] == [("token", "Plain "), ("token", "answer")]
    assert ai.scoped is None and ai.seen_messages == MESSAGES


async def test_api_providers_loop_and_report_each_tool_call(db_session, session_factory, monkeypatch):
    await _read_only_server(db_session)
    monkeypatch.setattr(
        mcp_client, "call_tool", AsyncMock(return_value=("Plans start at $5", False))
    )
    ai = LoopingAI()

    events = await _collect(session_factory, ai)

    assert [e.kind for e in events] == ["activity", "token"]
    assert events[0].payload == {"tool": "notes__search", "label": "search from notes"}
    assert events[1].text == "You noted: Plans start at $5"
    system_prompt, transcript, tools = ai.turns[0]
    assert system_prompt.startswith("You are ClawChat." + TOOLS_HINT)
    assert [t["function"]["name"] for t in tools] == ["notes__search"]
    # Earlier turns are replayed before the message being answered.
    assert [(e["role"], e["content"]) for e in transcript[:3]] == [
        ("user", "hi"),
        ("assistant", "hello"),
        ("user", "What did I note about pricing?"),
    ]
    call = (await db_session.execute(select(AgentToolCall))).scalar_one()
    assert (call.run_id, call.tool_name, call.status) == (
        None,
        "notes__search",
        ToolCallStatus.SUCCEEDED,
    )


async def test_cli_providers_get_a_scoped_endpoint_and_the_hint(db_session, session_factory):
    await _read_only_server(db_session)
    ai = CliAI()

    events = await _collect(session_factory, ai)

    assert "".join(e.text for e in events) == "Plain answer"
    assert ai.scoped is not None and ai.scoped.token
    assert ai.seen_messages[0]["content"] == "You are ClawChat." + TOOLS_HINT
    assert ai.seen_messages[1:] == MESSAGES[1:]
    assert current_cli_tools.get() is None  # the scope ended with the reply


async def test_a_failing_loop_surfaces_to_the_caller(db_session, session_factory):
    await _read_only_server(db_session)

    class BrokenAI:
        supports_native_tool_calling = True

        async def tool_turn(self, **_):
            raise RuntimeError("model down")

    with pytest.raises(RuntimeError, match="model down"):
        await _collect(session_factory, BrokenAI())


async def test_the_sse_stream_carries_tool_activity_before_the_answer(
    client, auth_headers, db_session, session_factory, monkeypatch
):
    from main import app
    from tests.test_chat_stream_contract import _general_chat, stub_ai

    await _read_only_server(db_session)
    monkeypatch.setattr(
        mcp_client, "call_tool", AsyncMock(return_value=("Plans start at $5", False))
    )
    monkeypatch.setattr("routers.chat.classify_intent", lambda *a, **k: _general_chat())
    previous = getattr(app.state, "session_factory", None)
    app.state.session_factory = session_factory
    try:
        resp = await client.post(
            "/api/chat/conversations", headers=auth_headers, json={}
        )
        conversation_id = resp.json()["id"]
        with stub_ai(LoopingAI()):
            resp = await client.post(
                "/api/chat/stream",
                headers=auth_headers,
                json={"conversation_id": conversation_id, "content": "pricing?"},
            )
    finally:
        if previous is None:
            delattr(app.state, "session_factory")
        else:
            app.state.session_factory = previous

    payloads = [
        json.loads(line[6:])
        for line in resp.text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]
    assert payloads[1] == {"tool_activity": {"tool": "notes__search", "label": "search from notes"}}
    assert payloads[2] == {"token": "You noted: Plans start at $5"}


async def test_the_websocket_path_pushes_tool_activity_for_the_streaming_message(
    db_session, session_factory, monkeypatch
):
    from tests.test_orchestrator_characterization import RecordingWS
    from services.chat.orchestrator import Orchestrator
    from models.conversation import Conversation
    from models.message import Message

    await _read_only_server(db_session)
    monkeypatch.setattr(
        mcp_client, "call_tool", AsyncMock(return_value=("Plans start at $5", False))
    )
    conv = Conversation(id="conv_tools", title="t")
    db_session.add(conv)
    db_session.add(Message(id="msg_u", conversation_id=conv.id, role="user", content="pricing?"))
    await db_session.commit()
    ws = RecordingWS()
    orchestrator = Orchestrator(LoopingAI(), ws, session_factory)

    await orchestrator._handle_general_chat(db_session, "user", conv.id, "pricing?")

    activity = next(m for m in ws.sent if m["type"] == "tool_activity")
    assert activity["data"]["tool"] == "notes__search"
    assert activity["data"]["conversation_id"] == conv.id
    assert activity["data"]["message_id"] == ws.stream_calls[0]["message_id"]
    assert ws.types()[-1] == "stream_end"
