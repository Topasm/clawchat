"""How far a run's result could have reached outside its own text.

A review card and a phone push say "low risk" only when the run could not
have changed anything: every skill in its chain only reads and writes prose,
and the run never called a tool. A chain that can write to the vault is high
risk, and anything else stays medium, so those results are always asked
about -- an automation's "don't ask next time" only ever covers low risk.
"""

from __future__ import annotations

from domain.review import ReviewRiskLevel
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from skills import parse_skill_chain
from sqlalchemy import func, or_, select
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


def skill_chain(task: AgentTask) -> list[str]:
    return parse_skill_chain(task.skill_chain) or [task.agent_type]


async def assess(db: AsyncSession, run: AgentRun, task: AgentTask) -> ReviewRiskLevel:
    chain = skill_chain(task)
    if any(skill in VAULT_WRITING_SKILLS for skill in chain):
        return ReviewRiskLevel.HIGH
    if not chain or any(skill not in READ_ONLY_SKILLS for skill in chain):
        return ReviewRiskLevel.MEDIUM
    # A tool call (web search, an MCP server, a permission request) means the
    # run reached beyond its prompt; the result is then worth a look.
    tool_events = await db.scalar(
        select(func.count())
        .select_from(AgentRunEvent)
        .where(
            AgentRunEvent.run_id == run.id,
            or_(
                AgentRunEvent.event_type.like("%tool%"),
                AgentRunEvent.event_type.like("%permission%"),
            ),
        )
    )
    return ReviewRiskLevel.LOW if not tool_events else ReviewRiskLevel.MEDIUM


__all__ = ["READ_ONLY_SKILLS", "VAULT_WRITING_SKILLS", "assess", "skill_chain"]
