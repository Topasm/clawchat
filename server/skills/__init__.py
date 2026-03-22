"""Skill registry — composable, project-bindable agent capabilities.

Each skill defines a system prompt, output format, and optional vault
document template.  Skills replace the old fixed-persona model
(planner / researcher / executor) with a composable, extensible set of
capabilities that can be chained on a single AgentTask.
"""

from __future__ import annotations

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


# Legacy persona → skill mapping (used during migration).
PERSONA_TO_SKILL: dict[str, str] = {
    "planner": "plan",
    "researcher": "research",
    "executor": "obsidian_sync",
}

AGENT_TYPE_TO_SKILL: dict[str, str] = {
    "general": "summarize",
    "research": "research",
    "drafting": "draft",
    "analysis": "data_analysis",
    "scheduling": "prioritize",
    "planner": "plan",
}


# Auto-register builtins on import.
from skills.builtins import register_builtins as _register_builtins  # noqa: E402

_register_builtins()
