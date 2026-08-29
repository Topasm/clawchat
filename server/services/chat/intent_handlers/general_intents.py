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


def register() -> None:
    for intent, handler in (
        ("search", search),
        ("daily_briefing", daily_briefing),
        ("weekly_review", weekly_review),
    ):
        register_intent_handler(IntentHandlerDef(intent=intent, handle=handler))
