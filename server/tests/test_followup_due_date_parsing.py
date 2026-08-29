"""Creating and updating a task must read ``due_date`` the same way.

The chat classifier hands both intents the same LLM-produced ``due_date``
string.  ``update_todo`` has always parsed it; ``create_todo`` used to forward
the raw string into ``todo_service.create_todo``, whose ``due_date`` lands in a
``DateTime`` column -- so the value was either rejected by the driver or, worse,
handled differently depending on which intent the classifier picked for the same
sentence.  These tests pin the unified behaviour on both sides.
"""

from datetime import datetime

import pytest

from services.tasks import todo_service
from services.chat.intent_handlers import IntentContext
from services.chat.intent_handlers.todo_intents import create_todo, update_todo


def _ctx(db, **params) -> IntentContext:
    return IntentContext(db=db, ai=None, ws=None, intent="test", params=params)


# ---------------------------------------------------------------------------
# The fix: an ISO string now reaches the column as a datetime on both paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_parses_an_iso_due_date_into_a_datetime(db_session):
    reply, metadata = await create_todo(
        _ctx(db_session, title="Ship the thing", due_date="2026-09-01T09:30:00")
    )

    todo = await todo_service.get_todo(db_session, metadata["todo_id"])
    assert isinstance(todo.due_date, datetime)
    assert todo.due_date.replace(tzinfo=None) == datetime(2026, 9, 1, 9, 30)
    assert "Ship the thing" in reply


@pytest.mark.asyncio
async def test_create_and_update_agree_on_the_same_string(db_session):
    """The asymmetry this closes: one value, one interpretation."""
    _reply, metadata = await create_todo(
        _ctx(db_session, title="Symmetry", due_date="2026-09-01")
    )
    created = await todo_service.get_todo(db_session, metadata["todo_id"])
    created_due = created.due_date

    await update_todo(_ctx(db_session, title="Symmetry", due_date="2026-09-01"))
    updated = await todo_service.get_todo(db_session, metadata["todo_id"])

    assert created_due == updated.due_date
    assert isinstance(updated.due_date, datetime)


@pytest.mark.asyncio
async def test_create_accepts_a_date_only_string(db_session):
    _reply, metadata = await create_todo(
        _ctx(db_session, title="Date only", due_date="2026-12-24")
    )

    todo = await todo_service.get_todo(db_session, metadata["todo_id"])
    assert todo.due_date.replace(tzinfo=None) == datetime(2026, 12, 24, 0, 0)


@pytest.mark.asyncio
async def test_create_without_a_due_date_leaves_it_unset(db_session):
    _reply, metadata = await create_todo(_ctx(db_session, title="No due date"))

    todo = await todo_service.get_todo(db_session, metadata["todo_id"])
    assert todo.due_date is None


@pytest.mark.asyncio
async def test_create_treats_an_empty_due_date_as_unset(db_session):
    """The classifier emits ``""`` for "no date"; that must not raise."""
    _reply, metadata = await create_todo(
        _ctx(db_session, title="Empty due date", due_date="")
    )

    todo = await todo_service.get_todo(db_session, metadata["todo_id"])
    assert todo.due_date is None


# ---------------------------------------------------------------------------
# Failure behaviour: deliberately identical on both paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_malformed_due_date_raises_on_create(db_session):
    """Matches the update path.

    ``ValueError`` propagates to the orchestrator, which reports module-intent
    failures as a reply the user actually sees.  Swallowing it into ``None``
    would create the task while quietly dropping the date the user asked for.
    """
    with pytest.raises(ValueError):
        await create_todo(
            _ctx(db_session, title="Bad date", due_date="next tuesday")
        )


@pytest.mark.asyncio
async def test_a_malformed_due_date_raises_on_update(db_session):
    _reply, metadata = await create_todo(_ctx(db_session, title="Existing"))
    assert metadata["todo_id"]

    with pytest.raises(ValueError):
        await update_todo(
            _ctx(db_session, title="Existing", due_date="next tuesday")
        )


@pytest.mark.asyncio
async def test_the_orchestrator_turns_the_failure_into_a_reply(db_session):
    """The user-visible half of the failure contract, for both intents."""
    from services.chat.orchestrator import Orchestrator

    orchestrator = Orchestrator(None, None, None)
    await create_todo(_ctx(db_session, title="Orchestrated"))

    for intent, action in (
        ("create_todo", "create a todo"),
        ("update_todo", "update a todo"),
    ):
        reply, metadata = await orchestrator.resolve_intent_response(
            db_session,
            "conv_missing",
            intent,
            {"title": "Orchestrated", "due_date": "not a date"},
            "",
        )
        assert reply == (
            f"I tried to {action} but something went wrong. Please try again."
        )
        assert metadata is None
