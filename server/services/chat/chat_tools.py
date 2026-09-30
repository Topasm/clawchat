"""A chat reply that may call the user's tools.

Chat gets web search and the MCP servers marked read-only; see
``catalog.tools_for_chat`` for why servers that need approval stay with
delegated work. API providers run ClawChat's tool loop, CLI providers get a
scoped connection to ClawChat's MCP endpoint, and either way each call is
recorded through the gateway without a run.
"""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from services.tools import agent_mcp_endpoint, gateway
from services.tools.approvals import describe_tool
from services.tools.catalog import ToolSpec, tools_for_chat
from services.tools.tool_loop import ToolCallRequest, run_tool_loop

TOOLS_HINT = (
    "\n\nThe tools available here only read. Work that changes anything outside "
    "ClawChat is done by delegating a task, where each call can be approved; "
    "suggest delegating when the user asks for that."
)


@dataclass(frozen=True)
class ReplyEvent:
    """Either a piece of the reply text or a note that a tool is being used."""

    kind: str  # "token" | "activity"
    text: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


def _activity(name: str) -> ReplyEvent:
    return ReplyEvent("activity", payload={"tool": name, "label": describe_tool(name)})


def _split(messages: list[dict]) -> tuple[str, list[dict], str]:
    """(system prompt, earlier turns, the message being answered)."""
    system = ""
    turns = list(messages)
    if turns and turns[0].get("role") == "system":
        system = str(turns[0].get("content") or "")
        turns = turns[1:]
    if turns and turns[-1].get("role") == "user":
        return system, turns[:-1], str(turns[-1].get("content") or "")
    return system, turns, "Hello"


def _with_hint(messages: list[dict]) -> list[dict]:
    if messages and messages[0].get("role") == "system":
        first = {**messages[0], "content": str(messages[0].get("content") or "") + TOOLS_HINT}
        return [first, *messages[1:]]
    return [{"role": "system", "content": TOOLS_HINT.strip()}, *messages]


async def _loop_events(
    session_factory: Any, ai: Any, messages: list[dict], specs: list[ToolSpec]
) -> AsyncIterator[ReplyEvent]:
    """Run the tool loop in a task so tool activity reaches the client as it happens."""
    system, history, user_message = _split(messages)
    queue: asyncio.Queue[ReplyEvent | None] = asyncio.Queue()

    async def on_tool_call(call: ToolCallRequest) -> None:
        await queue.put(_activity(call.name))

    async def run() -> None:
        try:
            async with session_factory() as db:

                async def invoke(spec: ToolSpec, arguments: dict[str, Any]) -> str:
                    return await gateway.invoke(db, run_id=None, spec=spec, arguments=arguments)

                text, _ = await run_tool_loop(
                    ai,
                    system_prompt=system + TOOLS_HINT,
                    user_message=user_message,
                    specs=specs,
                    invoke=invoke,
                    history=history,
                    on_tool_call=on_tool_call,
                )
            await queue.put(ReplyEvent("token", text or ""))
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while (event := await queue.get()) is not None:
            yield event
        await task  # surfaces what the loop raised
    finally:
        if not task.done():
            task.cancel()


async def reply_events(
    session_factory: Any, ai: Any, messages: list[dict]
) -> AsyncIterator[ReplyEvent]:
    """Stream the reply to ``messages`` (system first, the user's message last)."""
    async with session_factory() as db:
        specs = await tools_for_chat(db)
    if not specs:
        async for token in ai.stream_completion(messages):
            yield ReplyEvent("token", token)
        return

    if getattr(ai, "supports_native_tool_calling", False) and hasattr(ai, "tool_turn"):
        async for event in _loop_events(session_factory, ai, messages, specs):
            yield event
        return

    # The CLI's tool calls arrive on other requests, so they need their own
    # sessions on the same database.
    async with agent_mcp_endpoint.run_scope(None, specs, session_factory):
        async for token in ai.stream_completion(_with_hint(messages)):
            yield ReplyEvent("token", token)
