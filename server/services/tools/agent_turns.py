"""An agent turn with the tools the skill is offered.

API providers run ClawChat's tool loop; CLI providers get a scoped connection
to ClawChat's MCP endpoint and run their own loop. Either way each call goes
through ``gateway.invoke``.
"""

from typing import Any

from models.agent_task import AgentTask
from services.agents.agent_task_service import (
    ASK_USER_TOOL,
    ASK_USER_TOOL_INSTRUCTION,
    AgentInputRequest,
    _attached_run,
    generate_agent_turn,
    parse_needs_input,
)
from services.tools import agent_mcp_endpoint, gateway
from services.tools.catalog import ToolSpec, tools_for_skill
from services.tools.tool_loop import ToolCallRequest, run_tool_loop
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _ask_user_request(call: ToolCallRequest) -> AgentInputRequest | None:
    if call.name != "ask_user":
        return None
    question = str(call.arguments.get("question") or "").strip()
    if not question:
        return None
    raw_options = call.arguments.get("options") or []
    options = (
        tuple(str(option).strip() for option in raw_options[:6] if str(option).strip())
        if isinstance(raw_options, list)
        else ()
    )
    return AgentInputRequest(question, options)


async def generate_skill_turn(
    db: AsyncSession,
    task: AgentTask,
    ai_service: Any,
    *,
    skill_id: str,
    system_prompt: str,
    user_message: str,
) -> tuple[str | None, AgentInputRequest | None]:
    specs: list[ToolSpec] = await tools_for_skill(db, skill_id)
    run = await _attached_run(db, task) if specs else None
    if not specs or run is None:
        return await generate_agent_turn(
            ai_service, system_prompt=system_prompt, user_message=user_message
        )
    run_id = run.id

    if getattr(ai_service, "supports_native_tool_calling", False) and hasattr(
        ai_service, "tool_turn"
    ):
        async def invoke(spec: ToolSpec, arguments: dict[str, Any]) -> str:
            return await gateway.invoke(db, run_id=run_id, spec=spec, arguments=arguments)

        text, request = await run_tool_loop(
            ai_service,
            system_prompt=system_prompt + ASK_USER_TOOL_INSTRUCTION,
            user_message=user_message,
            specs=specs,
            invoke=invoke,
            extra_tools=[ASK_USER_TOOL],
            on_extra_tool=_ask_user_request,
        )
        if request is not None:
            return None, request
        question = parse_needs_input(text or "")
        if question is not None:
            return None, AgentInputRequest(question)
        return text, None

    # The CLI's tool calls arrive on other requests, so they need their own
    # sessions on the same database.
    session_factory = async_sessionmaker(db.bind, expire_on_commit=False)
    async with agent_mcp_endpoint.run_scope(run_id, specs, session_factory):
        return await generate_agent_turn(
            ai_service, system_prompt=system_prompt, user_message=user_message
        )
