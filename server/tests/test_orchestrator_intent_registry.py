"""The intent handler registry itself.

The registry is the contract between ``intent_classifier`` (which emits intent
names through LLM function calling) and the orchestrator (which routes them).
A name that drifts on either side fails silently at runtime, so it is pinned
here.

These also demonstrate the point of the split: a handler runs against an
explicit context, with no Orchestrator anywhere.
"""

import pytest
from sqlalchemy import select

from models.todo import Todo
from services.chat.intent_handlers import (
    INTENT_HANDLERS,
    MODULE_INTENTS,
    IntentContext,
    IntentHandlerDef,
    find_by_title,
    get_intent_handler,
    intent_ids,
    is_module_intent,
    register_intent_handler,
)
from services.chat.intent_handlers import event_intents, general_intents, todo_intents
from services.chat.intent_classifier import INTENT_TOOLS_SCHEMA
from services.chat.orchestrator import MODULE_INTENTS as ORCHESTRATOR_MODULE_INTENTS

# Intents the orchestrator answers itself rather than through the registry:
# both queue or stream work instead of returning a one-shot reply.
UNREGISTERED_INTENTS = {"general_chat", "delegate_task"}


def test_every_module_intent_has_a_handler():
    missing = set(MODULE_INTENTS) - set(INTENT_HANDLERS)
    assert missing == set()


def test_the_registry_holds_exactly_the_expected_intents():
    assert intent_ids() == sorted(
        set(MODULE_INTENTS) | {"search", "daily_briefing", "weekly_review", "query_runs"}
    )


def test_module_intent_flags_agree_with_the_intent_table():
    """The flag drives both error swallowing and the refresh broadcast."""
    for intent, definition in INTENT_HANDLERS.items():
        assert definition.module_intent is (intent in MODULE_INTENTS), intent


def test_module_intents_stay_importable_from_the_orchestrator():
    """main.py and the chat router reach the orchestrator, not the package."""
    assert ORCHESTRATOR_MODULE_INTENTS is MODULE_INTENTS


def test_the_classifier_and_the_registry_know_the_same_intents():
    """A name registered on one side only is a silent runtime dead end."""
    classifiable = set(
        INTENT_TOOLS_SCHEMA[0]["function"]["parameters"]["properties"]["intent"]["enum"]
    )
    assert set(INTENT_HANDLERS) | UNREGISTERED_INTENTS == classifiable


def test_is_module_intent_covers_unimplemented_table_entries(monkeypatch):
    monkeypatch.setitem(MODULE_INTENTS, "archive_todo", "archive a todo")
    assert is_module_intent("archive_todo") is True
    assert is_module_intent("search") is False
    assert is_module_intent("general_chat") is False


def test_registering_replaces_the_previous_definition():
    original = get_intent_handler("query_todos")
    try:
        async def _stub(ctx):
            return "stub", None

        register_intent_handler(
            IntentHandlerDef(intent="query_todos", handle=_stub, module_intent=True)
        )
        assert get_intent_handler("query_todos").handle is _stub
    finally:
        register_intent_handler(original)
    assert get_intent_handler("query_todos") is original


# --- handlers run standalone ---------------------------------------------


def _ctx(db, intent, params=None, **kwargs):
    """A context with no orchestrator behind it — that is the whole point."""
    return IntentContext(
        db=db, ai=None, ws=None, intent=intent, params=params or {}, **kwargs
    )


async def test_a_todo_handler_runs_without_an_orchestrator(db_session):
    text, metadata = await todo_intents.create_todo(
        _ctx(db_session, "create_todo", {"title": "Standalone"})
    )
    assert text == "Created task: 'Standalone'."
    stored = (
        await db_session.execute(select(Todo).where(Todo.title == "Standalone"))
    ).scalars().all()
    assert len(stored) == 1
    assert metadata["todo_id"] == stored[0].id


async def test_an_event_handler_runs_without_an_orchestrator(db_session):
    text, metadata = await event_intents.create_event(
        _ctx(
            db_session,
            "create_event",
            {"title": "Solo", "start_time": "2026-09-01T09:00:00+00:00"},
        )
    )
    assert text.startswith("Created event: 'Solo'")
    assert metadata["module"] == "events"


async def test_a_handler_reads_its_ai_from_the_context(db_session):
    """The context carries the *active* provider, already resolved."""
    calls = []

    class SpyAI:
        async def generate_completion(self, system_prompt, user_message):
            calls.append(user_message)
            return "summary"

    async def _briefing(db, ai_service):
        calls.append(ai_service)
        return "your day"

    import services.notifications.briefing_service as briefing_service

    original = briefing_service.generate_briefing
    briefing_service.generate_briefing = _briefing
    try:
        spy = SpyAI()
        ctx = IntentContext(
            db=db_session, ai=spy, ws=None, intent="daily_briefing", params={}
        )
        text, metadata = await general_intents.daily_briefing(ctx)
    finally:
        briefing_service.generate_briefing = original

    assert (text, metadata) == ("your day", None)
    assert calls == [spy]


async def test_handler_failures_are_not_swallowed_inside_the_handler(db_session):
    """The orchestrator owns the module-intent apology, not the handler."""
    with pytest.raises(Exception):
        await todo_intents.complete_todo(
            IntentContext(
                db=None, ai=None, ws=None, intent="complete_todo", params={"title": "x"}
            )
        )


# --- shared title matching ------------------------------------------------


class _Titled:
    def __init__(self, title):
        self.title = title


def test_find_by_title_prefers_an_exact_match():
    items = [_Titled("Report draft"), _Titled("Report")]
    assert find_by_title(items, "report").title == "Report"


def test_find_by_title_returns_the_only_substring_match():
    items = [_Titled("Report draft"), _Titled("Other")]
    assert find_by_title(items, "report").title == "Report draft"


def test_find_by_title_returns_the_first_of_several_inexact_matches():
    items = [_Titled("Report draft"), _Titled("Report final")]
    assert find_by_title(items, "report").title == "Report draft"


def test_find_by_title_returns_none_when_nothing_matches():
    assert find_by_title([_Titled("Report")], "invoice") is None
