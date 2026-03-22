"""LLM-based skill selection — replaces keyword-based detect_agent_type().

Given a task instruction and a set of available skills, uses LLM function
calling to select the best ordered subset of skills (a *skill chain*).
"""

from __future__ import annotations

import json
import logging

from services.ai_service import AIService
from skills import SkillDef, get_all_skills

logger = logging.getLogger(__name__)

_SELECTOR_SYSTEM_PROMPT = (
    "You are a task router for a personal assistant. Given a task description "
    "and a list of available skills, select which skills should be applied "
    "and in what order.\n\n"
    "Rules:\n"
    "- Select only the skills that are genuinely needed.\n"
    "- Order matters: later skills receive the output of earlier ones.\n"
    "- For simple tasks, a single skill is usually sufficient.\n"
    "- For complex tasks, chain 2-3 skills (e.g. research → summarize → draft).\n"
    "- Never select more than 4 skills."
)


def _build_select_tool(available_ids: list[str]) -> list[dict]:
    """Build the function-calling tool schema with dynamic enum."""
    return [
        {
            "type": "function",
            "function": {
                "name": "select_skills",
                "description": "Select an ordered list of skills to apply to this task",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "skill_chain": {
                            "type": "array",
                            "items": {"type": "string", "enum": available_ids},
                            "description": "Ordered list of skill IDs to run",
                        },
                        "reasoning": {
                            "type": "string",
                            "description": "Brief explanation of why these skills in this order",
                        },
                    },
                    "required": ["skill_chain", "reasoning"],
                },
            },
        }
    ]


async def select_skills(
    ai_service: AIService,
    instruction: str,
    available_skills: list[SkillDef] | None = None,
) -> list[str]:
    """Use LLM function calling to choose the best skill chain.

    Parameters
    ----------
    ai_service:
        The configured AI service for LLM calls.
    instruction:
        The user's task description.
    available_skills:
        Candidate skills to choose from.  Defaults to all registered skills.

    Returns
    -------
    list[str]
        Ordered list of skill IDs.  Falls back to ``["summarize"]`` on error.
    """
    if available_skills is None:
        available_skills = get_all_skills()

    if not available_skills:
        return ["summarize"]

    # Build a description block for the LLM.
    skill_descriptions = "\n".join(
        f"- **{s.id}** ({s.name}): {s.description}"
        for s in available_skills
    )
    user_message = (
        f"Available skills:\n{skill_descriptions}\n\n"
        f"Task: {instruction}"
    )

    available_ids = [s.id for s in available_skills]
    tools = _build_select_tool(available_ids)

    try:
        response = await ai_service.function_call(
            system_prompt=_SELECTOR_SYSTEM_PROMPT,
            user_message=user_message,
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "select_skills"}},
        )

        choices = response.get("choices", [])
        if not choices:
            return _fallback(instruction, available_ids)

        msg = choices[0].get("message", {})
        tool_calls = msg.get("tool_calls", [])
        if not tool_calls:
            return _fallback(instruction, available_ids)

        args = json.loads(tool_calls[0]["function"]["arguments"])
        chain = args.get("skill_chain", [])

        # Validate returned ids.
        chain = [sid for sid in chain if sid in available_ids]
        return chain if chain else _fallback(instruction, available_ids)

    except Exception:
        logger.exception("Skill selection via LLM failed, using fallback")
        return _fallback(instruction, available_ids)


def _fallback(instruction: str, available_ids: list[str]) -> list[str]:
    """Simple keyword fallback when LLM selection fails."""
    lower = instruction.lower()

    if any(w in lower for w in ["research", "find out", "look up", "investigate"]):
        return ["research"] if "research" in available_ids else ["summarize"]
    if any(w in lower for w in ["write", "draft", "compose", "email"]):
        return ["draft"] if "draft" in available_ids else ["summarize"]
    if any(w in lower for w in ["plan", "break down", "subtask"]):
        return ["plan"] if "plan" in available_ids else ["summarize"]
    if any(w in lower for w in ["analyze", "compare", "evaluate", "assess"]):
        return ["data_analysis"] if "data_analysis" in available_ids else ["summarize"]

    return ["summarize"] if "summarize" in available_ids else available_ids[:1]
