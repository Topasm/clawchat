"""Skill registry — composable, project-bindable agent capabilities.

Each skill defines a system prompt, output format, and optional vault
document template.  Skills replace the old fixed-persona model
(planner / researcher / executor) with a composable, extensible set of
capabilities that can be chained on a single AgentTask.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SkillDef:
    """Immutable definition of a single agent skill."""

    id: str
    name: str
    description: str
    system_prompt: str
    output_format: str = "markdown"          # "markdown" | "json" | "checklist"
    vault_template: str | None = None        # e.g. "{project}/Plan/{date}.md"
    tags: list[str] = field(default_factory=list)
    # Offered the web_search tool when a SearXNG instance is configured.
    uses_web_search: bool = False
    # MCP servers (by name) or tools (``server__tool``) this skill may use.
    # ``None`` offers every enabled server; ``()`` offers none.
    mcp_servers: tuple[str, ...] | None = None


# Central registry — populated by builtins (and future user-defined skills).
SKILL_REGISTRY: dict[str, SkillDef] = {}


def register_skill(skill: SkillDef) -> None:
    """Add *skill* to the global registry."""
    SKILL_REGISTRY[skill.id] = skill


def get_skill(skill_id: str) -> SkillDef | None:
    """Return a registered skill by id, or ``None``."""
    return SKILL_REGISTRY.get(skill_id)


def chain_skill_ids(skill_chain: str | None, task_type: str | None = None) -> list[str]:
    """The skill ids a task was delegated with, in chain order.

    ``skill_chain`` is the task's JSON array; a task without one names its
    skill in a ``delegate_<skill>`` task type.
    """
    try:
        chain = json.loads(skill_chain) if skill_chain else []
    except (json.JSONDecodeError, TypeError):
        chain = []
    ids = (
        [item for item in chain if isinstance(item, str)]
        if isinstance(chain, list)
        else []
    )
    if not ids and task_type and task_type.startswith("delegate_"):
        ids = [task_type.removeprefix("delegate_")]
    return ids


def with_skill_instructions(
    instruction: str, skill_chain: str | None, task_type: str | None = None
) -> str:
    """Put the delegated skills' instructions ahead of an external run's prompt.

    Home runs a skill chain with one system prompt per step, and OpenCode
    loads the skill files itself. A desktop worker or Paseo agent only ever
    receives this one prompt, so the skills ride in it or not at all.
    Unknown ids are skipped, as a chain may name a skill since removed.
    """
    skills = [
        skill
        for skill in (
            get_skill(skill_id) for skill_id in chain_skill_ids(skill_chain, task_type)
        )
        if skill is not None
    ]
    if not skills:
        return instruction
    blocks = [
        f"[Skill: {skill.name}]\n{skill.system_prompt.strip()}" for skill in skills
    ]
    return "\n\n".join([*blocks, instruction])


def get_all_skills() -> list[SkillDef]:
    """Return all registered skills, sorted by id."""
    return sorted(SKILL_REGISTRY.values(), key=lambda s: s.id)


def skill_ids() -> list[str]:
    """Return sorted list of all registered skill ids."""
    return sorted(SKILL_REGISTRY.keys())


# Legacy persona → skill mapping (used during migration).
PERSONA_TO_SKILL: dict[str, str] = {
    "planner": "plan",
    "researcher": "research",
    "executor": "obsidian_sync",
}


# Auto-register builtins on import, then the user's own skills over them.
from skills.builtins import register_builtins as _register_builtins  # noqa: E402
from skills.builtins import register_user_skills as _register_user_skills  # noqa: E402

_register_builtins()
_register_user_skills()
