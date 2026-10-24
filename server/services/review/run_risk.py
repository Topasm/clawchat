"""How far a run's result could have reached outside its own text.

A review card and a phone push say "low risk" only when the run could not
have changed anything and never left its prompt: every skill in its chain
only reads and writes prose, and the run called no tool at all. A run of
such a chain that only looked things up -- web search, a server the user
marked read-only, a shared note -- is ``read_only_tools``: still nothing it
could have changed, but what it read is part of the result, so the card
says so. A chain that can write to the vault is high risk, and anything
else stays medium, so those results are always asked about. An automation's
"don't ask next time" and the phone's one-tap Approve only ever cover low
risk; ``read_only_tools`` is the tier a project's own policy may adopt later,
never the phone.

Two audit trails say what a run called. Tools ClawChat brokers itself (web
search, MCP servers, the vault tools) are rows in ``agent_tool_calls``; a
call that needed the user's permission carries ``decided_at``. Executors that
run their own tools report them as run events: OpenCode records each call as
``tool_call`` (up to a cap), and a permission request from any executor is a
``*permission*`` event.
"""

from __future__ import annotations

import json

from domain.review import ReviewRiskLevel
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.agent_tools import AgentToolCall
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

#: Skills whose result is text about something, not a change to it.
READ_ONLY_SKILLS = frozenset(
    {
        "research",
        "summarize",
        "prioritize",
        "weekly_review",
        "code_review",
        "data_analysis",
        "plan",
    }
)
#: Skills whose approval writes into the user's vault.
VAULT_WRITING_SKILLS = frozenset({"obsidian_sync"})
#: OpenCode's own tools that only read: files, the workspace, the web, its list.
OPENCODE_READ_ONLY_TOOLS = frozenset(
    {"read", "grep", "glob", "list", "webfetch", "websearch", "codesearch", "todoread"}
)
#: Brokered tools whose call is a change, not a lookup, even without a permission.
WRITING_BRIDGE_TOOLS = frozenset({"vault_add_task"})
#: The one run event that names a tool the executor ran by itself.
TOOL_CALL_EVENT = "tool_call"


def skill_chain(task: AgentTask) -> list[str]:
    try:
        chain = json.loads(task.skill_chain) if task.skill_chain else []
    except (TypeError, ValueError):
        chain = []
    if not chain:
        chain = [task.agent_type]
    return [str(skill).replace("-", "_") for skill in chain if skill]


def _usage(run: AgentRun) -> dict:
    try:
        usage = json.loads(run.usage_json or "null")
    except (TypeError, ValueError):
        return {}
    return usage if isinstance(usage, dict) else {}


def _payload(payload_json: str | None) -> dict:
    try:
        payload = json.loads(payload_json or "null")
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _changed_files(run: AgentRun) -> bool:
    from services.review.review_item_service import run_changed_files

    return bool(run_changed_files(run))


async def tool_reach(db: AsyncSession, run: AgentRun) -> ReviewRiskLevel:
    """LOW when the run called no tool, READ_ONLY_TOOLS when every call only
    read, MEDIUM when any call could have changed something or is unknown."""
    if _changed_files(run):
        return ReviewRiskLevel.MEDIUM
    reach = ReviewRiskLevel.LOW

    events = (
        await db.execute(
            select(AgentRunEvent.event_type, AgentRunEvent.payload_json)
            .where(
                AgentRunEvent.run_id == run.id,
                or_(
                    AgentRunEvent.event_type.like("%tool%"),
                    AgentRunEvent.event_type.like("%permission%"),
                ),
            )
            .order_by(AgentRunEvent.sequence.asc())
        )
    ).all()
    recorded_calls = 0
    for event_type, payload_json in events:
        if event_type != TOOL_CALL_EVENT:
            # A permission request, or a tool event this code does not know.
            return ReviewRiskLevel.MEDIUM
        recorded_calls += 1
        if _payload(payload_json).get("tool") not in OPENCODE_READ_ONLY_TOOLS:
            return ReviewRiskLevel.MEDIUM
        reach = ReviewRiskLevel.READ_ONLY_TOOLS
    counted = _usage(run).get("tool_calls")
    if isinstance(counted, int) and counted > recorded_calls:
        # The executor stopped recording calls one by one; the rest are unseen.
        return ReviewRiskLevel.MEDIUM

    calls = (
        await db.execute(
            select(AgentToolCall.tool_name, AgentToolCall.decided_at).where(
                AgentToolCall.run_id == run.id
            )
        )
    ).all()
    for tool_name, decided_at in calls:
        if decided_at is not None or tool_name in WRITING_BRIDGE_TOOLS:
            return ReviewRiskLevel.MEDIUM
        reach = ReviewRiskLevel.READ_ONLY_TOOLS
    return reach


async def assess(db: AsyncSession, run: AgentRun, task: AgentTask) -> ReviewRiskLevel:
    chain = skill_chain(task)
    if any(skill in VAULT_WRITING_SKILLS for skill in chain):
        return ReviewRiskLevel.HIGH
    if not chain or any(skill not in READ_ONLY_SKILLS for skill in chain):
        return ReviewRiskLevel.MEDIUM
    return await tool_reach(db, run)


__all__ = [
    "OPENCODE_READ_ONLY_TOOLS",
    "READ_ONLY_SKILLS",
    "VAULT_WRITING_SKILLS",
    "WRITING_BRIDGE_TOOLS",
    "assess",
    "skill_chain",
    "tool_reach",
]
