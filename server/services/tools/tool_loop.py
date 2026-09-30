"""The tool-calling loop for providers ClawChat talks to over an API.

CLI providers (Claude Code, Codex CLI) run their own loop against ClawChat's
MCP endpoint instead; see ``agent_mcp_endpoint``.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from services.tools.catalog import ToolSpec

logger = logging.getLogger(__name__)

MAX_TOOL_STEPS = 8
TOOLS_INSTRUCTION = (
    "\n\nYou can call tools. Call them only when they help with the task, "
    "one purpose at a time, and base your final answer on what they returned."
)
_FINAL_NUDGE = (
    "You have used the tool budget for this step. Give your final answer now "
    "from what you have, without calling more tools."
)


@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class AssistantTurn:
    content: str | None
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    # Provider-specific items to replay as this turn (e.g. Responses API output).
    raw: Any = None


def parse_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


async def run_tool_loop(
    ai: Any,
    *,
    system_prompt: str,
    user_message: str,
    specs: list[ToolSpec],
    invoke: Callable[[ToolSpec, dict[str, Any]], Awaitable[str]],
    extra_tools: list[dict[str, Any]] | None = None,
    on_extra_tool: Callable[[ToolCallRequest], Any] | None = None,
    max_steps: int = MAX_TOOL_STEPS,
) -> tuple[str, Any]:
    """Loop until the model answers without calling tools.

    Returns ``(text, None)`` for an answer, or ``(None, value)`` when a call to
    one of ``extra_tools`` (e.g. ``ask_user``) ends the turn and
    ``on_extra_tool`` returned ``value`` for it.
    """
    by_name = {spec.name: spec for spec in specs}
    definitions = [spec.as_function() for spec in specs] + list(extra_tools or [])
    transcript: list[dict[str, Any]] = [{"role": "user", "content": user_message}]
    system = system_prompt + TOOLS_INSTRUCTION

    for step in range(max_steps + 1):
        last = step == max_steps
        if last:
            transcript.append({"role": "user", "content": _FINAL_NUDGE})
        turn: AssistantTurn = await ai.tool_turn(
            system_prompt=system,
            transcript=transcript,
            tools=[] if last else definitions,
        )
        if not turn.tool_calls:
            return (turn.content or "").strip(), None
        for call in turn.tool_calls:
            if call.name not in by_name and on_extra_tool is not None:
                outcome = on_extra_tool(call)
                if outcome is not None:
                    return None, outcome
        transcript.append(
            {
                "role": "assistant",
                "content": turn.content,
                "tool_calls": turn.tool_calls,
                "raw": turn.raw,
            }
        )
        for call in turn.tool_calls:
            spec = by_name.get(call.name)
            if spec is None:
                result = f"There is no tool named {call.name}."
            else:
                result = await invoke(spec, call.arguments)
            transcript.append(
                {"role": "tool", "tool_call_id": call.id, "name": call.name, "content": result}
            )
    return "", None  # unreachable: the last step offers no tools
