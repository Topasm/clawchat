"""Intent handler registry — one callable per classified chat intent.

Chat intents used to be a single ``if / elif`` chain inside the orchestrator,
so adding an intent meant growing one method and unit-testing an intent meant
driving the whole orchestrator.  This mirrors the shape ``skills/__init__.py``
already uses for agent skills: a frozen definition dataclass, a module-level
registry dict, ``register`` / ``get`` accessors, and builtins auto-registered
on import.

A handler receives an explicit :class:`IntentContext` -- never the orchestrator
-- and returns the reply the caller should deliver.  Both chat transports share
that reply: the WebSocket path wraps it in an assistant message, and the SSE
path emits it as a single token.

The intent *names* are the contract with ``intent_classifier``: they are what
the LLM emits through function calling, so renaming one breaks classification
silently at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

# Intents that map to module actions.  The values are the human phrasing used
# when the orchestrator has to talk *about* the action ("I tried to <label> but
# something went wrong").
MODULE_INTENTS = {
    "create_todo": "create a todo",
    "query_todos": "list your todos",
    "update_todo": "update a todo",
    "delete_todo": "delete a todo",
    "complete_todo": "complete a todo",
    "plan_task": "plan a task",
    "create_event": "create a calendar event",
    "query_events": "check your calendar",
    "update_event": "update a calendar event",
    "delete_event": "delete a calendar event",
    "suggest_time": "suggest a time for an event",
    "check_conflicts": "check for scheduling conflicts",
    "analyze_schedule": "analyze your schedule",
}

# (reply text, action metadata) — metadata is ``None`` when the reply changed
# nothing the clients need to refresh.
IntentReply = tuple[str, "dict | None"]


@dataclass(frozen=True, slots=True)
class IntentContext:
    """Everything a handler is allowed to reach.

    Deliberately not the orchestrator: a handler that could reach back into it
    would keep the coupling the registry exists to remove.  ``ai`` is already
    resolved to the *active* provider, so handlers never re-derive it.
    """

    db: AsyncSession
    ai: Any
    ws: Any
    intent: str
    params: dict
    content: str = ""
    conversation_id: str | None = None
    #: For handlers that start background work of their own (planning). Absent
    #: in tests that drive a handler directly; such work then runs inline.
    session_factory: Any = None


class IntentHandler(Protocol):
    """Resolve one intent into the reply its caller should deliver."""

    async def __call__(self, ctx: IntentContext) -> IntentReply: ...


@dataclass(frozen=True, slots=True)
class IntentHandlerDef:
    """Immutable registration for a single intent."""

    intent: str
    handle: IntentHandler
    #: Module intents own user data.  Two behaviours hang off this: failures
    #: are swallowed into a generic apology rather than surfacing as an error
    #: reply, and a successful action with metadata triggers a
    #: ``module_data_changed`` broadcast so clients refetch.
    module_intent: bool = False


# Central registry — populated by the builtins below.
INTENT_HANDLERS: dict[str, IntentHandlerDef] = {}


def register_intent_handler(definition: IntentHandlerDef) -> None:
    """Add *definition* to the global registry."""
    INTENT_HANDLERS[definition.intent] = definition


def get_intent_handler(intent: str) -> IntentHandlerDef | None:
    """Return the registration for *intent*, or ``None``."""
    return INTENT_HANDLERS.get(intent)


def intent_ids() -> list[str]:
    """Return sorted list of all registered intent names."""
    return sorted(INTENT_HANDLERS.keys())


def is_module_intent(intent: str) -> bool:
    """Whether *intent* acts on user data owned by a client-side module.

    Falls back to :data:`MODULE_INTENTS` so an intent listed there but not yet
    implemented still gets module treatment (and the "coming soon" reply).
    """
    definition = INTENT_HANDLERS.get(intent)
    if definition is not None:
        return definition.module_intent
    return intent in MODULE_INTENTS


def find_by_title(items, title: str):
    """Case-insensitive title substring match; prefers exact match."""
    title_lower = title.lower()
    matches = [x for x in items if title_lower in x.title.lower()]
    if len(matches) == 1:
        return matches[0]
    exact = [x for x in matches if x.title.lower() == title_lower]
    return exact[0] if exact else (matches[0] if matches else None)


# Auto-register builtins on import.
from services.chat.intent_handlers import (  # noqa: E402
    event_intents as _event_intents,
    general_intents as _general_intents,
    scheduling_intents as _scheduling_intents,
    todo_intents as _todo_intents,
)

for _module in (_todo_intents, _event_intents, _scheduling_intents, _general_intents):
    _module.register()
