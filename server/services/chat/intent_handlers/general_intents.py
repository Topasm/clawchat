"""Cross-module intents that answer from the whole workspace.

Unlike module intents these own no user data, so a failure is not swallowed
into an apology here -- it propagates to the caller's error handling.  Only
:func:`search` catches, because a failed lookup is a normal outcome rather
than a broken action.
"""

from __future__ import annotations

import logging

from services import search_service
from services.notifications import briefing_service
from services.chat.intent_handlers import (
    IntentContext,
    IntentHandlerDef,
    IntentReply,
    register_intent_handler,
)

logger = logging.getLogger(__name__)


async def search(ctx: IntentContext) -> IntentReply:
    query = ctx.params.get("query", ctx.content)
    try:
        hits, total = await search_service.search(ctx.db, query)
    except Exception:
        logger.exception("Search failed for query: %s", query)
        return f"Sorry, I had trouble searching for '{query}'. Please try again.", None

    if not hits:
        return f"No results found for '{query}'.", None

    lines = [f"Found {total} result(s) for '{query}':"]
    for h in hits[:10]:
        label = h.title or h.type
        preview = h.preview[:80] + "..." if len(h.preview) > 80 else h.preview
        lines.append(f"- **[{h.type}]** {label}: {preview}")
    if total > 10:
        lines.append(f"...and {total - 10} more.")
    return "\n".join(lines), None


async def daily_briefing(ctx: IntentContext) -> IntentReply:
    return await briefing_service.generate_briefing(ctx.db, ctx.ai), None


async def weekly_review(ctx: IntentContext) -> IntentReply:
    from services.notifications import weekly_review_service

    return await weekly_review_service.generate_weekly_review(ctx.db, ctx.ai), None


async def query_runs(ctx: IntentContext) -> IntentReply:
    """Where the agent is with delegated work, and what it needs from the user.

    Scoped to the thread's project when it has one, otherwise to the whole
    workspace: "is anything waiting on me?" in an unscoped chat means anywhere.
    """
    from models.conversation import Conversation
    from services.chat.conversation_context import collect_agent_activity, describe_run

    project_id = None
    if ctx.conversation_id:
        conversation = await ctx.db.get(Conversation, ctx.conversation_id)
        project_id = conversation.project_id if conversation else None
    activity, reviews = await collect_agent_activity(ctx.db, project_id=project_id)
    if not activity and not reviews:
        return (
            "No agent work is running right now, and nothing is waiting for your review.",
            None,
        )
    lines = []
    waiting = [row for row in activity if row[0].status == "waiting_input"]
    for run, task, todo in activity:
        lines.append(f"- {describe_run(run, task, todo)}")
    summary = f"Agent work ({len(activity)} run{'s' if len(activity) != 1 else ''}):\n"
    summary += "\n".join(lines)
    needs = []
    if waiting:
        needs.append(f"{len(waiting)} waiting for your answer")
    if reviews:
        needs.append(f"{len(reviews)} waiting for your review")
    if needs:
        summary += "\n\nNeeds you: " + ", ".join(needs) + "."
    return summary, None


def register() -> None:
    for intent, handler in (
        ("search", search),
        ("daily_briefing", daily_briefing),
        ("weekly_review", weekly_review),
        ("query_runs", query_runs),
    ):
        register_intent_handler(IntentHandlerDef(intent=intent, handle=handler))
