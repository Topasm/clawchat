"""Characterization tests for the orchestrator's intent dispatch.

These pin the *observable* behaviour of every intent the orchestrator knows
about -- the exact reply text, the exact metadata dict, the error fallbacks,
and the WebSocket event sequence (including whether ``module_data_changed``
fires).  They exist so the split of the intent chain into a handler registry
can be proven to change nothing.

They intentionally assert on literal strings: the point is to detect drift,
not to describe intent.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from domain.task import TaskStatus
from exceptions import AIUnavailableError
from models.conversation import Conversation
from models.event import Event
from models.message import Message
from models.project import Project
from models.todo import Todo
from services.chat import orchestrator as orchestrator_module
from services.chat.orchestrator import MODULE_INTENTS, Orchestrator
from utils import make_id


class RecordingWS:
    """Captures every payload the orchestrator pushes to a user."""

    def __init__(self):
        self.sent: list[dict] = []
        self.stream_calls: list[dict] = []
        self.stream_result = "streamed"
        self.stream_error: Exception | None = None

    async def send_json(self, user_id: str, data: dict):
        self.sent.append(data)

    async def stream_to_user(self, *, user_id, message_id, conversation_id, token_iterator):
        self.stream_calls.append(
            {"user_id": user_id, "message_id": message_id, "conversation_id": conversation_id}
        )
        if self.stream_error is not None:
            raise self.stream_error
        # Drain so the stub AI's generator is actually exercised.
        async for _ in token_iterator:
            pass
        return self.stream_result

    def types(self) -> list[str]:
        return [d["type"] for d in self.sent]


class StubAI:
    model = "stub-model"

    def __init__(self, completion: str = "analysis text", title: str = "Generated Title"):
        self._completion = completion
        self._title = title
        self.completion_calls: list[dict] = []

    async def stream_completion(self, messages):
        self.stream_messages = messages
        yield "hello"

    async def generate_completion(self, system_prompt: str, user_message: str) -> str:
        self.completion_calls.append(
            {"system_prompt": system_prompt, "user_message": user_message}
        )
        return self._completion

    async def generate_title(self, content: str) -> str:
        return self._title


@pytest.fixture
def ws():
    return RecordingWS()


@pytest.fixture
def ai():
    return StubAI()


@pytest.fixture
def orchestrator(session_factory, ws, ai):
    return Orchestrator(
        ai_service=ai,
        ws_manager=ws,
        session_factory=session_factory,
    )


async def resolve(orchestrator, db, intent, params=None, content="", conversation_id=None):
    return await orchestrator.resolve_intent_response(
        db, conversation_id, intent, params or {}, content
    )


async def _todo(db, title: str, **kwargs) -> Todo:
    todo = Todo(
        id=make_id("todo_"),
        title=title,
        status=kwargs.pop("status", TaskStatus.PENDING),
        priority=kwargs.pop("priority", "medium"),
        **kwargs,
    )
    db.add(todo)
    await db.flush()
    return todo


async def _event(db, title: str, start: datetime, **kwargs) -> Event:
    event = Event(id=make_id("evt_"), title=title, start_time=start, **kwargs)
    db.add(event)
    await db.flush()
    return event


async def _conversation(db, **kwargs) -> Conversation:
    conv = Conversation(id=make_id("conv_"), **kwargs)
    db.add(conv)
    await db.flush()
    return conv


# --- the intent surface ---------------------------------------------------


def test_module_intent_names_are_frozen():
    """intent_classifier emits these exact names via LLM function calling."""
    assert MODULE_INTENTS == {
        "create_todo": "create a todo",
        "query_todos": "list your todos",
        "update_todo": "update a todo",
        "delete_todo": "delete a todo",
        "complete_todo": "complete a todo",
        "create_event": "create a calendar event",
        "query_events": "check your calendar",
        "update_event": "update a calendar event",
        "delete_event": "delete a calendar event",
        "suggest_time": "suggest a time for an event",
        "check_conflicts": "check for scheduling conflicts",
        "analyze_schedule": "analyze your schedule",
    }


# --- todo intents ---------------------------------------------------------


async def test_create_todo_reply_and_metadata(orchestrator, db_session):
    text, metadata = await resolve(
        orchestrator, db_session, "create_todo", {"title": "Buy milk", "priority": "high"}
    )
    assert text == "Created task: 'Buy milk' with high priority."
    assert metadata["action_type"] == "todo_created"
    assert metadata["module"] == "todos"
    assert metadata["todo_title"] == "Buy milk"


async def test_create_todo_defaults_title_and_priority(orchestrator, db_session):
    text, _ = await resolve(orchestrator, db_session, "create_todo", {})
    assert text == "Created task: 'Untitled task' with medium priority."


async def test_create_todo_inherits_the_conversation_project(orchestrator, db_session):
    project = Project(id=make_id("prj_"), title="Apollo")
    db_session.add(project)
    await db_session.flush()
    conv = await _conversation(db_session, project_id=project.id)

    _text, metadata = await resolve(
        orchestrator,
        db_session,
        "create_todo",
        {"title": "Scoped"},
        conversation_id=conv.id,
    )
    todo = await db_session.get(Todo, metadata["todo_id"])
    assert todo.project_id == project.id


async def test_create_todo_inherits_the_conversation_parent_task(orchestrator, db_session):
    parent = await _todo(db_session, "Parent")
    conv = await _conversation(db_session, project_todo_id=parent.id)

    _text, metadata = await resolve(
        orchestrator,
        db_session,
        "create_todo",
        {"title": "Child"},
        conversation_id=conv.id,
    )
    todo = await db_session.get(Todo, metadata["todo_id"])
    assert todo.parent_id == parent.id


async def test_query_todos_lists_five_and_counts_the_rest(orchestrator, db_session):
    for i in range(7):
        await _todo(db_session, f"Task {i}")

    text, metadata = await resolve(orchestrator, db_session, "query_todos")
    assert metadata is None
    lines = text.split("\n")
    assert lines[0] == "You have 7 task(s):"
    assert len(lines) == 7  # header + 5 items + "and more"
    assert lines[-1] == "...and 2 more."


async def test_update_todo_without_a_title(orchestrator, db_session):
    text, metadata = await resolve(orchestrator, db_session, "update_todo", {})
    assert text == "Which task would you like to update? Please mention the task name."
    assert metadata is None


async def test_update_todo_not_found(orchestrator, db_session):
    text, metadata = await resolve(
        orchestrator, db_session, "update_todo", {"title": "Ghost"}
    )
    assert text == "I couldn't find a task matching 'Ghost'. Try listing your tasks first."
    assert metadata is None


async def test_update_todo_without_any_change(orchestrator, db_session):
    await _todo(db_session, "Standing task")
    text, metadata = await resolve(
        orchestrator, db_session, "update_todo", {"title": "Standing task"}
    )
    assert text == (
        "I found 'Standing task', but I'm not sure what to change. "
        "What would you like to update?"
    )
    assert metadata is None


async def test_update_todo_applies_known_fields(orchestrator, db_session):
    todo = await _todo(db_session, "Refactor")
    text, metadata = await resolve(
        orchestrator,
        db_session,
        "update_todo",
        {
            "title": "Refactor",
            "description": "split it up",
            "priority": "high",
            "due_date": "2026-09-01T09:00:00+00:00",
            "status": TaskStatus.IN_PROGRESS,
        },
    )
    assert text == "Updated task 'Refactor'."
    assert metadata == {
        "action_type": "todo_updated",
        "module": "todos",
        "todo_id": todo.id,
        "todo_title": "Refactor",
    }
    assert todo.description == "split it up"
    assert todo.priority == "high"


async def test_delete_todo_reports_the_removed_task(orchestrator, db_session):
    todo = await _todo(db_session, "Obsolete")
    todo_id = todo.id

    text, metadata = await resolve(
        orchestrator, db_session, "delete_todo", {"title": "Obsolete"}
    )
    assert text == "Deleted task 'Obsolete'."
    assert metadata == {
        "action_type": "todo_deleted",
        "module": "todos",
        "todo_id": todo_id,
        "todo_title": "Obsolete",
    }
    assert await db_session.get(Todo, todo_id) is None


async def test_delete_todo_without_a_title(orchestrator, db_session):
    text, metadata = await resolve(orchestrator, db_session, "delete_todo", {})
    assert text == "Which task would you like to delete? Please mention the task name."
    assert metadata is None


async def test_title_match_prefers_the_exact_title(orchestrator, db_session):
    await _todo(db_session, "Report draft")
    exact = await _todo(db_session, "Report")

    _text, metadata = await resolve(
        orchestrator, db_session, "delete_todo", {"title": "Report"}
    )
    assert metadata["todo_id"] == exact.id


# --- event intents --------------------------------------------------------


async def test_create_event_requires_a_start_time(orchestrator, db_session):
    text, metadata = await resolve(
        orchestrator, db_session, "create_event", {"title": "Standup"}
    )
    assert text == "I'd create event 'Standup', but I need a start time. When should it be?"
    assert metadata is None


async def test_create_event_reply_and_metadata(orchestrator, db_session):
    text, metadata = await resolve(
        orchestrator,
        db_session,
        "create_event",
        {
            "title": "Standup",
            "start_time": "2026-09-01T09:00:00+00:00",
            "end_time": "2026-09-01T09:15:00+00:00",
            "location": "Room 1",
        },
    )
    assert text == "Created event: 'Standup' starting at 2026-09-01 09:00:00+00:00."
    assert metadata["action_type"] == "event_created"
    assert metadata["module"] == "events"
    assert metadata["event_title"] == "Standup"
    assert metadata["event_start_time"] == "2026-09-01T09:00:00+00:00"
    event = await db_session.get(Event, metadata["event_id"])
    assert event.location == "Room 1"


async def test_create_event_inherits_the_conversation_project(orchestrator, db_session):
    project = Project(id=make_id("prj_"), title="Apollo")
    db_session.add(project)
    await db_session.flush()
    conv = await _conversation(db_session, project_id=project.id)

    _text, metadata = await resolve(
        orchestrator,
        db_session,
        "create_event",
        {"title": "Review", "start_time": "2026-09-01T09:00:00+00:00"},
        conversation_id=conv.id,
    )
    event = await db_session.get(Event, metadata["event_id"])
    assert event.project_id == project.id


async def test_query_events_when_empty(orchestrator, db_session):
    text, metadata = await resolve(orchestrator, db_session, "query_events")
    assert text == "You don't have any upcoming events."
    assert metadata is None


async def test_query_events_lists_five_and_counts_the_rest(orchestrator, db_session):
    base = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    for i in range(6):
        await _event(db_session, f"Event {i}", base + timedelta(days=i))

    text, metadata = await resolve(orchestrator, db_session, "query_events")
    assert metadata is None
    lines = text.split("\n")
    assert lines[0] == "You have 6 event(s):"
    assert lines[1] == f"- Event 0 at {base.replace(tzinfo=None)}"
    assert lines[-1] == "...and 1 more."


async def test_update_event_without_a_title(orchestrator, db_session):
    text, metadata = await resolve(orchestrator, db_session, "update_event", {})
    assert text == "Which event would you like to update? Please mention the event name."
    assert metadata is None


async def test_update_event_not_found(orchestrator, db_session):
    text, metadata = await resolve(
        orchestrator, db_session, "update_event", {"title": "Ghost"}
    )
    assert text == (
        "I couldn't find an event matching 'Ghost'. Try checking your calendar first."
    )
    assert metadata is None


async def test_update_event_without_any_change(orchestrator, db_session):
    await _event(db_session, "Standup", datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc))
    text, metadata = await resolve(
        orchestrator, db_session, "update_event", {"title": "Standup"}
    )
    assert text == (
        "I found 'Standup', but I'm not sure what to change. What would you like to update?"
    )
    assert metadata is None


async def test_update_event_applies_known_fields(orchestrator, db_session):
    event = await _event(
        db_session, "Standup", datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    )
    text, metadata = await resolve(
        orchestrator,
        db_session,
        "update_event",
        {
            "title": "Standup",
            "description": "daily sync",
            "start_time": "2026-09-02T09:00:00+00:00",
            "end_time": "2026-09-02T09:30:00+00:00",
            "location": "Room 2",
        },
    )
    assert text == "Updated event 'Standup'."
    assert metadata == {
        "action_type": "event_updated",
        "module": "events",
        "event_id": event.id,
        "event_title": "Standup",
    }
    assert event.location == "Room 2"


async def test_delete_event_reports_the_removed_event(orchestrator, db_session):
    event = await _event(
        db_session, "Obsolete", datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    )
    event_id = event.id

    text, metadata = await resolve(
        orchestrator, db_session, "delete_event", {"title": "Obsolete"}
    )
    assert text == "Deleted event 'Obsolete'."
    assert metadata == {
        "action_type": "event_deleted",
        "module": "events",
        "event_id": event_id,
        "event_title": "Obsolete",
    }
    assert await db_session.get(Event, event_id) is None


async def test_delete_event_without_a_title(orchestrator, db_session):
    text, metadata = await resolve(orchestrator, db_session, "delete_event", {})
    assert text == "Which event would you like to delete? Please mention the event name."
    assert metadata is None


# --- scheduling intents ---------------------------------------------------


async def test_suggest_time_without_slots(orchestrator, db_session, monkeypatch):
    async def _none(*args, **kwargs):
        return []

    monkeypatch.setattr(
        "services.calendar.scheduling_service.suggest_best_time", _none, raising=True
    )
    text, metadata = await resolve(orchestrator, db_session, "suggest_time", {})
    assert text == (
        "I couldn't find any available time slots in the next week. "
        "Your schedule looks quite full!"
    )
    assert metadata is None


async def test_suggest_time_formats_the_slots(orchestrator, db_session, ai, monkeypatch):
    captured = {}
    suggestions = [
        {"start": "2026-09-01T09:00:00+00:00", "reason": "morning is free"},
        {"start": "2026-09-02T14:00:00+00:00", "reason": "after lunch"},
    ]

    async def _suggest(db, ai_service, title, duration, preferred):
        captured.update(
            {"ai": ai_service, "title": title, "duration": duration, "preferred": preferred}
        )
        return suggestions

    monkeypatch.setattr(
        "services.calendar.scheduling_service.suggest_best_time", _suggest, raising=True
    )
    text, metadata = await resolve(
        orchestrator,
        db_session,
        "suggest_time",
        {"title": "1:1", "duration": "45", "preferred_date": "2026-09-01T00:00:00+00:00"},
    )

    assert captured["ai"] is ai
    assert captured["title"] == "1:1"
    assert captured["duration"] == 45
    assert captured["preferred"] == datetime(2026, 9, 1, tzinfo=timezone.utc)
    lines = text.split("\n")
    assert lines[0] == "Here are my top suggestions for '1:1':"
    assert lines[1] == "1. Tuesday, Sep 01 at 09:00 AM — morning is free"
    assert lines[2] == "2. Wednesday, Sep 02 at 02:00 PM — after lunch"
    assert lines[-1] == "Just say 'schedule it at [time]' to create the event."
    assert metadata == {
        "action_type": "scheduling_suggestions",
        "suggestions": suggestions,
        "title": "1:1",
    }


async def test_suggest_time_defaults(orchestrator, db_session, monkeypatch):
    captured = {}

    async def _suggest(db, ai_service, title, duration, preferred):
        captured.update({"title": title, "duration": duration, "preferred": preferred})
        return []

    monkeypatch.setattr(
        "services.calendar.scheduling_service.suggest_best_time", _suggest, raising=True
    )
    await resolve(orchestrator, db_session, "suggest_time", {})
    assert captured == {"title": "Meeting", "duration": 60, "preferred": None}


async def test_check_conflicts_when_free(orchestrator, db_session, monkeypatch):
    async def _none(*args, **kwargs):
        return []

    monkeypatch.setattr("services.calendar.scheduling_service.find_conflicts", _none, raising=True)
    text, metadata = await resolve(
        orchestrator,
        db_session,
        "check_conflicts",
        {"start_time": "2026-09-01T09:00:00+00:00"},
    )
    assert text == "You're free during that time! No scheduling conflicts found."
    assert metadata == {"action_type": "no_conflicts"}


async def test_check_conflicts_defaults_the_window_to_one_hour(
    orchestrator, db_session, monkeypatch
):
    captured = {}

    async def _conflicts(db, start, end):
        captured.update({"start": start, "end": end})
        return [{"title": "Standup", "start_time": "2026-09-01T09:00:00+00:00"}]

    monkeypatch.setattr(
        "services.calendar.scheduling_service.find_conflicts", _conflicts, raising=True
    )
    text, metadata = await resolve(
        orchestrator,
        db_session,
        "check_conflicts",
        {"start_time": "2026-09-01T09:00:00+00:00"},
    )
    assert captured["end"] - captured["start"] == timedelta(hours=1)
    assert text == "You have 1 conflict(s):\n- Standup (2026-09-01T09:00:00+00:00)"
    assert metadata["action_type"] == "conflicts_found"
    assert metadata["conflicts"] == [
        {"title": "Standup", "start_time": "2026-09-01T09:00:00+00:00"}
    ]


async def test_check_conflicts_without_a_start_time_uses_now(
    orchestrator, db_session, monkeypatch
):
    captured = {}

    async def _conflicts(db, start, end):
        captured.update({"start": start})
        return []

    monkeypatch.setattr(
        "services.calendar.scheduling_service.find_conflicts", _conflicts, raising=True
    )
    await resolve(orchestrator, db_session, "check_conflicts", {})
    assert abs(
        (captured["start"] - datetime.now(timezone.utc)).total_seconds()
    ) < 60


async def test_analyze_schedule_on_a_clear_week(orchestrator, db_session):
    text, metadata = await resolve(orchestrator, db_session, "analyze_schedule")
    assert text == "Your schedule for the next 7 days is completely clear!"
    assert metadata is None


async def test_analyze_schedule_asks_the_ai(orchestrator, db_session, ai):
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)
    await _event(db_session, "Standup", start)

    text, metadata = await resolve(orchestrator, db_session, "analyze_schedule")
    assert text == "analysis text"
    assert metadata is None
    call = ai.completion_calls[0]
    assert call["system_prompt"].startswith("You are a scheduling analyst.")
    assert "Here are my events for the next 7 days:" in call["user_message"]
    assert "- Standup at" in call["user_message"]


# --- error fallback -------------------------------------------------------


async def test_module_intent_failure_falls_back_to_a_generic_apology(
    orchestrator, db_session, monkeypatch
):
    async def _boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr("services.tasks.todo_service.get_todos", _boom, raising=True)
    text, metadata = await resolve(orchestrator, db_session, "query_todos")
    assert text == "I tried to list your todos but something went wrong. Please try again."
    assert metadata is None


async def test_unhandled_module_intent_reports_coming_soon(
    orchestrator, db_session, monkeypatch
):
    monkeypatch.setitem(MODULE_INTENTS, "archive_todo", "archive a todo")
    text, metadata = await resolve(
        orchestrator, db_session, "archive_todo", {"title": "Old"}
    )
    assert text == (
        "I understood you want to archive a todo: 'Old'. This action is coming soon!"
    )
    assert metadata is None


async def test_unhandled_module_intent_without_a_title(
    orchestrator, db_session, monkeypatch
):
    monkeypatch.setitem(MODULE_INTENTS, "archive_todo", "archive a todo")
    text, _ = await resolve(orchestrator, db_session, "archive_todo", {})
    assert text == "I understood you want to archive a todo. This action is coming soon!"


# --- search ---------------------------------------------------------------


def _hit(type_: str, title: str, preview: str):
    return SimpleNamespace(type=type_, title=title, preview=preview)


async def test_search_with_no_hits(orchestrator, db_session, monkeypatch):
    async def _empty(db, query):
        return [], 0

    monkeypatch.setattr("services.search_service.search", _empty, raising=True)
    text, metadata = await resolve(
        orchestrator, db_session, "search", {"query": "widgets"}
    )
    assert text == "No results found for 'widgets'."
    assert metadata is None


async def test_search_falls_back_to_the_raw_message_as_the_query(
    orchestrator, db_session, monkeypatch
):
    seen = {}

    async def _empty(db, query):
        seen["query"] = query
        return [], 0

    monkeypatch.setattr("services.search_service.search", _empty, raising=True)
    await resolve(orchestrator, db_session, "search", {}, content="find widgets")
    assert seen["query"] == "find widgets"


async def test_search_formats_and_truncates(orchestrator, db_session, monkeypatch):
    hits = [_hit("todo", f"Item {i}", "x" * 100) for i in range(12)]

    async def _hits(db, query):
        return hits, 12

    monkeypatch.setattr("services.search_service.search", _hits, raising=True)
    text, metadata = await resolve(
        orchestrator, db_session, "search", {"query": "widgets"}
    )
    lines = text.split("\n")
    assert lines[0] == "Found 12 result(s) for 'widgets':"
    assert lines[1] == f"- **[todo]** Item 0: {'x' * 80}..."
    assert lines[-1] == "...and 2 more."
    assert len(lines) == 12  # header + 10 hits + overflow line
    assert metadata is None


async def test_search_uses_the_entry_type_when_a_hit_has_no_title(
    orchestrator, db_session, monkeypatch
):
    async def _hits(db, query):
        return [_hit("message", None, "short")], 1

    monkeypatch.setattr("services.search_service.search", _hits, raising=True)
    text, _ = await resolve(orchestrator, db_session, "search", {"query": "q"})
    assert text.split("\n")[1] == "- **[message]** message: short"


async def test_search_failure_apologizes_without_raising(
    orchestrator, db_session, monkeypatch
):
    async def _boom(db, query):
        raise RuntimeError("fts exploded")

    monkeypatch.setattr("services.search_service.search", _boom, raising=True)
    text, metadata = await resolve(
        orchestrator, db_session, "search", {"query": "widgets"}
    )
    assert text == "Sorry, I had trouble searching for 'widgets'. Please try again."
    assert metadata is None


# --- briefing / review ----------------------------------------------------


async def test_daily_briefing_delegates_to_the_briefing_service(
    orchestrator, db_session, ai, monkeypatch
):
    seen = {}

    async def _briefing(db, ai_service):
        seen["ai"] = ai_service
        return "your day"

    monkeypatch.setattr(
        "services.notifications.briefing_service.generate_briefing", _briefing, raising=True
    )
    text, metadata = await resolve(orchestrator, db_session, "daily_briefing")
    assert text == "your day"
    assert metadata is None
    assert seen["ai"] is ai


async def test_weekly_review_delegates_to_the_review_service(
    orchestrator, db_session, ai, monkeypatch
):
    seen = {}

    async def _review(db, ai_service):
        seen["ai"] = ai_service
        return "your week"

    monkeypatch.setattr(
        "services.notifications.weekly_review_service.generate_weekly_review", _review, raising=True
    )
    text, metadata = await resolve(orchestrator, db_session, "weekly_review")
    assert text == "your week"
    assert metadata is None
    assert seen["ai"] is ai


async def test_briefing_failures_propagate_to_the_caller(
    orchestrator, db_session, monkeypatch
):
    """Unlike module intents, these have no swallowing fallback."""

    async def _boom(db, ai_service):
        raise RuntimeError("no ai")

    monkeypatch.setattr(
        "services.notifications.briefing_service.generate_briefing", _boom, raising=True
    )
    with pytest.raises(RuntimeError):
        await resolve(orchestrator, db_session, "daily_briefing")


# --- intents with no self-contained answer --------------------------------


@pytest.mark.parametrize("intent", ["general_chat", "delegate_task", "unknown_intent"])
async def test_intents_without_a_one_shot_answer(orchestrator, db_session, intent):
    assert await resolve(orchestrator, db_session, intent) is None


# --- handle_message: routing, messaging, ws events ------------------------


def _stub_classifier(monkeypatch, intent: str, params: dict | None = None):
    async def _classify(content, ai_service):
        return SimpleNamespace(intent=intent, params=params or {})

    monkeypatch.setattr(orchestrator_module, "classify_intent", _classify, raising=True)


async def _seeded_conversation(session_factory, title=None) -> tuple[str, str]:
    async with session_factory() as db:
        conv = Conversation(id=make_id("conv_"), title=title)
        db.add(conv)
        await db.flush()
        msg = Message(
            id=make_id("msg_"),
            conversation_id=conv.id,
            role="user",
            content="do the thing",
        )
        db.add(msg)
        await db.commit()
        return conv.id, msg.id


async def test_module_intent_broadcasts_a_module_refresh(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory)
    _stub_classifier(monkeypatch, "create_todo", {"title": "Buy milk"})

    await orchestrator.handle_message("user-1", conv_id, msg_id, "buy milk")

    assert ws.types() == [
        "stream_start",
        "stream_chunk",
        "stream_end",
        "module_data_changed",
        "conversation_updated",
    ]
    assert ws.sent[-2]["data"] == {"module": "todos"}
    assert ws.sent[2]["data"]["metadata"]["action_type"] == "todo_created"

    async with session_factory() as db:
        user_msg = await db.get(Message, msg_id)
        assert user_msg.intent == "create_todo"
        conv = await db.get(Conversation, conv_id)
        assert conv.title == "Generated Title"


async def test_module_intent_without_metadata_skips_the_refresh(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "query_todos", {})

    await orchestrator.handle_message("user-1", conv_id, msg_id, "what's on my list")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]


async def test_search_does_not_broadcast_a_module_refresh(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "search", {"query": "widgets"})

    async def _empty(db, query):
        return [], 0

    monkeypatch.setattr("services.search_service.search", _empty, raising=True)
    await orchestrator.handle_message("user-1", conv_id, msg_id, "find widgets")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]
    assert ws.sent[2]["data"]["full_content"] == "No results found for 'widgets'."


async def test_daily_briefing_sends_one_assistant_message(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "daily_briefing", {})

    async def _briefing(db, ai_service):
        return "your day"

    monkeypatch.setattr(
        "services.notifications.briefing_service.generate_briefing", _briefing, raising=True
    )
    await orchestrator.handle_message("user-1", conv_id, msg_id, "brief me")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]
    async with session_factory() as db:
        saved = (
            await db.get(Message, ws.sent[0]["data"]["message_id"])
        )
        assert saved.intent == "daily_briefing"
        assert saved.content == "your day"
        assert saved.metadata_json is None


async def test_weekly_review_sends_one_assistant_message(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "weekly_review", {})

    async def _review(db, ai_service):
        return "your week"

    monkeypatch.setattr(
        "services.notifications.weekly_review_service.generate_weekly_review", _review, raising=True
    )
    await orchestrator.handle_message("user-1", conv_id, msg_id, "review my week")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]
    assert ws.sent[2]["data"]["full_content"] == "your week"


async def test_general_chat_streams_and_saves_the_completion(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory)
    _stub_classifier(monkeypatch, "general_chat", {})

    await orchestrator.handle_message("user-1", conv_id, msg_id, "hello there")

    assert len(ws.stream_calls) == 1
    assert ws.types() == ["conversation_updated", "stream_end"]
    assert ws.sent[-1]["data"]["conversation_id"] == conv_id
    async with session_factory() as db:
        saved = await db.get(Message, ws.stream_calls[0]["message_id"])
        assert saved.role == "assistant"
        assert saved.content == "streamed"
        assert saved.intent == "general_chat"
        conv = await db.get(Conversation, conv_id)
        assert conv.title == "Generated Title"


async def test_an_unknown_intent_falls_back_to_general_chat(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "who_knows", {})

    await orchestrator.handle_message("user-1", conv_id, msg_id, "hello there")

    assert len(ws.stream_calls) == 1


async def test_a_failed_stream_closes_the_orphaned_stream(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "general_chat", {})
    ws.stream_error = RuntimeError("socket died")

    await orchestrator.handle_message("user-1", conv_id, msg_id, "hello there")

    # The orphaned stream is closed, then the generic error message is sent.
    assert ws.types() == ["stream_end", "stream_start", "stream_chunk", "stream_end"]
    assert ws.sent[0]["data"]["full_content"] == ""
    assert ws.sent[-1]["data"]["full_content"] == (
        "Something went wrong processing your message. Please try again."
    )


async def test_an_unavailable_ai_reports_a_specific_message(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")

    async def _classify(content, ai_service):
        raise AIUnavailableError("down")

    monkeypatch.setattr(orchestrator_module, "classify_intent", _classify, raising=True)
    await orchestrator.handle_message("user-1", conv_id, msg_id, "hello there")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]
    assert ws.sent[-1]["data"]["full_content"] == (
        "I'm sorry, I can't reach the AI provider right now. "
        "Please check that your AI service is running."
    )
    async with session_factory() as db:
        saved = await db.get(Message, ws.sent[0]["data"]["message_id"])
        assert saved.message_type == "system"


async def test_delegate_task_queues_a_background_task(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "delegate_task", {"instruction": "research widgets"})

    async def _select(ai_service, instruction):
        return ["research"]

    launched: list = []

    def _launch(run_id, coro):
        coro.close()
        launched.append(run_id)

    monkeypatch.setattr("skills.selector.select_skills", _select, raising=True)
    monkeypatch.setattr(
        "services.agents.agent_run_service.launch_execution", _launch, raising=True
    )

    await orchestrator.handle_message("user-1", conv_id, msg_id, "research widgets")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]
    metadata = ws.sent[2]["data"]["metadata"]
    assert metadata["action_type"] == "task_delegated"
    assert metadata["agent_type"] == "research"
    assert metadata["skill_chain"] == ["research"]
    assert metadata["is_multi_agent"] is False
    assert launched == [metadata["run_id"]]
    assert ws.sent[2]["data"]["full_content"] == (
        f"Got it! I've queued that as a background task (ID: {metadata['task_id']}). "
        "I'll notify you when it's done."
    )


async def test_delegate_task_announces_a_multi_skill_chain(
    orchestrator, session_factory, ws, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory, title="Existing")
    _stub_classifier(monkeypatch, "delegate_task", {"instruction": "plan the launch"})

    async def _select(ai_service, instruction):
        return ["plan", "draft"]

    def _launch(run_id, coro):
        coro.close()

    monkeypatch.setattr("skills.selector.select_skills", _select, raising=True)
    monkeypatch.setattr(
        "services.agents.agent_run_service.launch_execution", _launch, raising=True
    )

    await orchestrator.handle_message("user-1", conv_id, msg_id, "plan the launch")

    metadata = ws.sent[2]["data"]["metadata"]
    assert metadata["is_multi_agent"] is True
    assert metadata["skill_chain"] == ["plan", "draft"]
    assert ws.sent[2]["data"]["full_content"] == (
        f"Got it! I'll run a skill chain (plan → draft) for this task "
        f"(ID: {metadata['task_id']}). I'll keep you updated on progress."
    )


async def test_a_failed_title_generation_is_not_fatal(
    orchestrator, session_factory, ws, ai, monkeypatch
):
    conv_id, msg_id = await _seeded_conversation(session_factory)
    _stub_classifier(monkeypatch, "query_todos", {})

    async def _boom(content):
        raise RuntimeError("no title")

    monkeypatch.setattr(ai, "generate_title", _boom, raising=False)
    await orchestrator.handle_message("user-1", conv_id, msg_id, "what's on my list")

    assert ws.types() == ["stream_start", "stream_chunk", "stream_end"]
    async with session_factory() as db:
        conv = await db.get(Conversation, conv_id)
        assert not conv.title


# --- active_ai ------------------------------------------------------------


def test_active_ai_defaults_to_the_injected_service(session_factory, ai, ws):
    orch = Orchestrator(ai_service=ai, ws_manager=ws, session_factory=session_factory)
    assert orch.active_ai is ai


def test_active_ai_prefers_the_app_state_provider(session_factory, ai, ws):
    override = StubAI()
    orch = Orchestrator(
        ai_service=ai,
        ws_manager=ws,
        session_factory=session_factory,
        app_state=SimpleNamespace(active_ai=override),
    )
    assert orch.active_ai is override


def test_active_ai_falls_back_when_app_state_has_no_provider(session_factory, ai, ws):
    orch = Orchestrator(
        ai_service=ai,
        ws_manager=ws,
        session_factory=session_factory,
        app_state=SimpleNamespace(),
    )
    assert orch.active_ai is ai
