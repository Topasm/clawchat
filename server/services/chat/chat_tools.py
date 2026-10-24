"""A chat reply that may call the user's tools.

Chat gets web search and the MCP servers marked read-only; see
``catalog.tools_for_chat`` for why servers that need approval stay with
delegated work. API providers run ClawChat's tool loop, CLI providers get a
scoped connection to ClawChat's MCP endpoint, and either way each call is
recorded through the gateway without a run.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from services.tools import agent_mcp_endpoint, gateway
from services.tools.approvals import describe_tool
from services.tools.catalog import ToolSpec, tools_for_chat
from services.tools.tool_loop import ToolCallRequest, run_tool_loop

TOOLS_HINT = (
    "\n\nThe tools available here only read; adding a task to a shared TODO.md "
    "only proposes it for the user's approval. Other work that changes anything "
    "outside ClawChat is done by delegating a task, where each call can be "
    "approved; suggest delegating when the user asks for that."
)


@dataclass(frozen=True)
class ReplyEvent:
    """Either a piece of the reply text or a note that a tool is being used."""

    kind: str  # "token" | "activity"
    text: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


def _activity(name: str) -> ReplyEvent:
    return ReplyEvent("activity", payload={"tool": name, "label": describe_tool(name)})


def phase(name: str, label: str) -> ReplyEvent:
    """A stage of the reply with no tool behind it ("reading your message").

    Carried as tool activity with ``kind: phase`` so the client shows the
    label itself instead of "Using …".
    """
    return ReplyEvent("activity", payload={"tool": name, "label": label, "kind": "phase"})


async def _relayed(
    produce: Callable[[asyncio.Queue[ReplyEvent | None]], Awaitable[None]],
) -> AsyncIterator[ReplyEvent]:
    """Run ``produce`` as a task and yield what it puts on the queue, as it happens.

    ``produce`` is handed the queue and must put ``None`` last; that is how
    tool activity reaches the client while the model is still working.
    """
    queue: asyncio.Queue[ReplyEvent | None] = asyncio.Queue()

    async def run() -> None:
        try:
            await produce(queue)
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while (event := await queue.get()) is not None:
            yield event
        await task  # surfaces what the producer raised
    finally:
        if not task.done():
            task.cancel()


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
    session_factory: Any,
    ai: Any,
    messages: list[dict],
    specs: list[ToolSpec],
    requested_by: str,
) -> AsyncIterator[ReplyEvent]:
    """Run the tool loop in a task so tool activity reaches the client as it happens."""
    system, history, user_message = _split(messages)

    async def produce(queue: asyncio.Queue[ReplyEvent | None]) -> None:
        async def on_tool_call(call: ToolCallRequest) -> None:
            await queue.put(_activity(call.name))

        async with session_factory() as db:

            async def invoke(spec: ToolSpec, arguments: dict[str, Any]) -> str:
                return await gateway.invoke(
                    db,
                    run_id=None,
                    spec=spec,
                    arguments=arguments,
                    requested_by=requested_by,
                )

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

    async for event in _relayed(produce):
        yield event


async def reply_events(
    session_factory: Any,
    ai: Any,
    messages: list[dict],
    *,
    conversation_id: str | None = None,
) -> AsyncIterator[ReplyEvent]:
    """Stream the reply to ``messages`` (system first, the user's message last).

    [conversation_id] is what a read of a device's shared folder is recorded
    as having been asked by.
    """
    requested_by = f"chat:{conversation_id}" if conversation_id else "chat"
    async with session_factory() as db:
        specs = await tools_for_chat(db)
    if not specs:
        async for token in ai.stream_completion(messages):
            yield ReplyEvent("token", token)
        return

    if getattr(ai, "supports_native_tool_calling", False) and hasattr(ai, "tool_turn"):
        async for event in _loop_events(session_factory, ai, messages, specs, requested_by):
            yield event
        return

    # The CLI's tool calls arrive on other requests, so they need their own
    # sessions on the same database. The endpoint names each call as it
    # begins, and the stream runs in a task so that name reaches the client
    # while the CLI is still at work rather than with the finished answer.
    async def produce(queue: asyncio.Queue[ReplyEvent | None]) -> None:
        async def on_tool_call(name: str) -> None:
            await queue.put(_activity(name))

        async with agent_mcp_endpoint.run_scope(
            None, specs, session_factory, requested_by=requested_by, on_tool_call=on_tool_call
        ):
            async for token in ai.stream_completion(_with_hint(messages)):
                await queue.put(ReplyEvent("token", token))

    async for event in _relayed(produce):
        yield event
