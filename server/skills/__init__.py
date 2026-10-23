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


def get_all_skills() -> list[SkillDef]:
    """Return all registered skills, sorted by id."""
    return sorted(SKILL_REGISTRY.values(), key=lambda s: s.id)


def skill_ids() -> list[str]:
    """Return sorted list of all registered skill ids."""
    return sorted(SKILL_REGISTRY.keys())


def parse_skill_chain(raw: str | None) -> list[str]:
    """The skill ids in a task's ``skill_chain`` JSON, in chain order.

    Unset, malformed or non-list JSON reads as an empty chain, entries that
    are not strings are dropped, and a hyphenated skill name is read as its
    id. The ids are not checked against the registry.
    """
    if not raw:
        return []
    try:
        chain = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(chain, list):
        return []
    return [item.replace("-", "_") for item in chain if isinstance(item, str) and item]


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
