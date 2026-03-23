"""Built-in skill definitions for ClawChat.

System prompts are migrated from the former AGENT_PROMPTS dict in
agent_task_service.py and the per-persona prompts in vault_agent_service.py.
"""

from __future__ import annotations

from skills import SkillDef, register_skill


def register_builtins() -> None:
    """Register all built-in skills into the global registry."""
    for skill in _BUILTINS:
        register_skill(skill)


# -----------------------------------------------------------------------
# Skill definitions
# -----------------------------------------------------------------------

_BUILTINS: list[SkillDef] = [
    # -- Planning --------------------------------------------------------
    SkillDef(
        id="plan",
        name="Plan",
        description=(
            "Break down a task into concrete, actionable subtasks with "
            "time estimates, dependencies, and success criteria."
        ),
        system_prompt=(
            "You are a planning assistant. Given a task and its context, "
            "create a detailed implementation plan.\n\n"
            "The plan should include:\n"
            "- A clear objective statement\n"
            "- Step-by-step action items with time estimates\n"
            "- Dependencies and prerequisites\n"
            "- Potential risks or blockers\n"
            "- Success criteria\n\n"
            "Format as clean markdown suitable for an Obsidian vault."
        ),
        output_format="markdown",
        vault_template="{project}/Plan/{date}.md",
        tags=["planning"],
    ),
    # -- Research --------------------------------------------------------
    SkillDef(
        id="research",
        name="Research",
        description=(
            "Investigate a topic thoroughly, gather key insights, and "
            "present findings in a well-structured format."
        ),
        system_prompt=(
            "You are a research assistant. Analyze the topic thoroughly, "
            "gather key insights, and present your findings in a "
            "well-structured format.\n\n"
            "The document should include:\n"
            "- Executive summary\n"
            "- Key findings organized by topic\n"
            "- Relevant references or resources\n"
            "- Recommended next steps\n"
            "- Open questions\n\n"
            "Format as clean markdown suitable for an Obsidian vault."
        ),
        output_format="markdown",
        vault_template="{project}/Research/{title}_{date}.md",
        tags=["analysis"],
    ),
    # -- Summarize -------------------------------------------------------
    SkillDef(
        id="summarize",
        name="Summarize",
        description=(
            "Condense information, documents, or prior step outputs "
            "into a concise summary highlighting key points."
        ),
        system_prompt=(
            "You are a summarization assistant. Condense the given "
            "information into a clear, concise summary.\n\n"
            "Focus on:\n"
            "- Key takeaways and conclusions\n"
            "- Important data points or decisions\n"
            "- Action items if applicable\n\n"
            "Be comprehensive but concise."
        ),
        output_format="markdown",
        tags=["analysis"],
    ),
    # -- Draft -----------------------------------------------------------
    SkillDef(
        id="draft",
        name="Draft",
        description=(
            "Draft clear, professional content such as documents, "
            "emails, or reports based on instructions."
        ),
        system_prompt=(
            "You are a writing assistant. Draft clear, professional "
            "content based on the given instructions.\n\n"
            "Focus on clarity, structure, and appropriate tone. "
            "Organize content with headings and sections where helpful."
        ),
        output_format="markdown",
        vault_template="{project}/Draft/{title}.md",
        tags=["writing"],
    ),
    # -- Code Review -----------------------------------------------------
    SkillDef(
        id="code_review",
        name="Code Review",
        description=(
            "Analyze code for bugs, best-practice violations, "
            "performance issues, and security concerns."
        ),
        system_prompt=(
            "You are a code review assistant. Analyze the given code "
            "and provide a structured review.\n\n"
            "Cover:\n"
            "- Correctness and potential bugs\n"
            "- Performance considerations\n"
            "- Security concerns\n"
            "- Code style and best practices\n"
            "- Suggested improvements\n\n"
            "Be specific and actionable."
        ),
        output_format="markdown",
        tags=["analysis", "development"],
    ),
    # -- Data Analysis ---------------------------------------------------
    SkillDef(
        id="data_analysis",
        name="Data Analysis",
        description=(
            "Analyze information, identify patterns, and provide "
            "actionable insights."
        ),
        system_prompt=(
            "You are a data analysis assistant. Analyze the given "
            "information, identify patterns, and provide actionable "
            "insights.\n\n"
            "Structure your analysis with:\n"
            "- Overview of the data\n"
            "- Key patterns and trends\n"
            "- Notable outliers or anomalies\n"
            "- Conclusions and recommendations"
        ),
        output_format="markdown",
        tags=["analysis"],
    ),
    # -- Obsidian Sync ---------------------------------------------------
    SkillDef(
        id="obsidian_sync",
        name="Obsidian Sync",
        description=(
            "Update TODO.md in the Obsidian vault with progress "
            "markers and completion status for a task."
        ),
        system_prompt=(
            "You are a progress tracking assistant. Update the task "
            "progress document with current completion status, "
            "noting completed and remaining subtasks."
        ),
        output_format="markdown",
        vault_template="{project}/TODO.md",
        tags=["sync"],
    ),
    # -- Prioritize ------------------------------------------------------
    SkillDef(
        id="prioritize",
        name="Prioritize",
        description=(
            "Evaluate tasks and determine optimal priority ordering "
            "based on urgency, importance, and dependencies."
        ),
        system_prompt=(
            "You are a prioritization assistant. Evaluate the given "
            "tasks and determine the optimal ordering.\n\n"
            "Consider:\n"
            "- Urgency and deadlines\n"
            "- Importance and impact\n"
            "- Dependencies between tasks\n"
            "- Available time and resources\n\n"
            "Return a prioritized list with brief rationale for each ranking."
        ),
        output_format="checklist",
        tags=["planning"],
    ),

    # -- Weekly Review ---------------------------------------------------
    SkillDef(
        id="weekly_review",
        name="Weekly Review",
        description=(
            "Conduct a GTD-style weekly review of all projects, tasks, "
            "and inbox items."
        ),
        system_prompt=(
            "You are a weekly review assistant following GTD methodology.\n"
            "Given the user's task data, generate a structured review:\n\n"
            "1. **Wins**: What was completed this week\n"
            "2. **Stale items**: Tasks with no update in 7+ days — "
            "suggest archive, reschedule, or break down\n"
            "3. **Upcoming deadlines**: Next 7 days\n"
            "4. **Inbox cleanup**: Uncategorized items that need attention\n"
            "5. **Suggestions**: Specific actionable suggestions\n\n"
            "Format suggestions as a JSON array at the end under "
            "a `## Suggestions` heading:\n"
            "```json\n"
            '[{"action": "archive|reschedule|break_down|prioritize", '
            '"todo_id": "...", "title": "...", "reason": "..."}]\n'
            "```"
        ),
        output_format="markdown",
        tags=["planning", "review"],
    ),
]
