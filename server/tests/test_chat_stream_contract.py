"""SSE chat contract: event ordering, send de-duplication, and intent handling."""

import json
from contextlib import contextmanager

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select

from main import app
from models.conversation import Conversation
from models.message import Message
from models.todo import Todo
from services.intent_classifier import IntentResult
from services.orchestrator import Orchestrator


class StubAI:
    """Minimal stand-in for the AI provider used by the chat endpoints."""

    def __init__(self, tokens=("Hello", " there"), title="Generated Title"):
        self._tokens = tokens
        self._title = title

    async def stream_completion(self, messages):
        for token in self._tokens:
            yield token

    async def generate_title(self, content: str) -> str:
        return self._title


def _restore_state(key: str, previous):
    """Put ``app.state`` back as it was.

    Starlette's State keeps values in ``_state``, not ``__dict__``, so clearing
    a key means ``delattr`` -- popping ``__dict__`` silently leaks the stub into
    every later test module.
    """
    if previous is None:
        try:
            delattr(app.state, key)
        except (AttributeError, KeyError):
            pass
    else:
        setattr(app.state, key, previous)


class NullWebSocketManager:
    """The chat stream never pushes over WebSocket; the orchestrator API needs one."""

    async def send_json(self, *args, **kwargs):
        return None


class RecordingOrchestrator(Orchestrator):
    """Real intent resolution, but background dispatch is recorded, not run."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.dispatched: list[str] = []

    async def handle_message(self, *, user_id, conversation_id, message_id, content):
        self.dispatched.append(message_id)


@pytest_asyncio.fixture(autouse=True)
async def chat_runtime(session_factory):
    """Install the app.state wiring that ``lifespan`` normally provides."""
    orchestrator = RecordingOrchestrator(
        ai_service=StubAI(),
        ws_manager=NullWebSocketManager(),
        session_factory=session_factory,
        app_state=app.state,
    )
    previous_factory = getattr(app.state, "session_factory", None)
    previous_orchestrator = getattr(app.state, "orchestrator", None)
    app.state.session_factory = session_factory
    app.state.orchestrator = orchestrator
    try:
        yield orchestrator
    finally:
        _restore_state("session_factory", previous_factory)
        _restore_state("orchestrator", previous_orchestrator)


@contextmanager
def stub_ai(ai=None):
    ai = ai or StubAI()
    previous_ai = getattr(app.state, "ai_service", None)
    previous_active = getattr(app.state, "active_ai", None)
    app.state.ai_service = ai
    app.state.active_ai = ai
    try:
        yield ai
    finally:
        _restore_state("ai_service", previous_ai)
        _restore_state("active_ai", previous_active)


async def _create_conversation(client: AsyncClient, auth_headers) -> str:
    resp = await client.post("/api/chat/conversations", headers=auth_headers, json={})
    assert resp.status_code == 201
    return resp.json()["id"]


def _sse_payloads(body: str) -> list[str]:
    return [line[len("data: ") :] for line in body.splitlines() if line.startswith("data: ")]


# --- event ordering ------------------------------------------------------


async def test_done_is_the_final_event(client: AsyncClient, auth_headers, monkeypatch):
    """Clients stop reading at [DONE], so nothing may be emitted after it."""
    monkeypatch.setattr(
        "routers.chat.classify_intent",
        lambda *args, **kwargs: _general_chat(),
    )
    conversation_id = await _create_conversation(client, auth_headers)

    with stub_ai():
        resp = await client.post(
            "/api/chat/stream",
            headers=auth_headers,
            json={"conversation_id": conversation_id, "content": "hi"},
        )

    payloads = _sse_payloads(resp.text)
    assert payloads[-1] == "[DONE]"
    assert payloads.count("[DONE]") == 1


async def test_generated_title_reaches_the_client(
    client: AsyncClient, auth_headers, monkeypatch
):
    """The title used to be emitted after [DONE], where no client could see it."""
    monkeypatch.setattr(
        "routers.chat.classify_intent",
        lambda *args, **kwargs: _general_chat(),
    )
    conversation_id = await _create_conversation(client, auth_headers)

    with stub_ai(StubAI(title="Weekend Plans")):
        resp = await client.post(
            "/api/chat/stream",
            headers=auth_headers,
            json={"conversation_id": conversation_id, "content": "hi"},
        )

    payloads = _sse_payloads(resp.text)
    titles = [
        json.loads(p)["title_generated"]
        for p in payloads
        if p != "[DONE]" and "title_generated" in json.loads(p)
    ]
    assert titles == ["Weekend Plans"]
    assert payloads.index("[DONE]") > payloads.index(
        next(p for p in payloads if p != "[DONE]" and "title_generated" in json.loads(p))
    )


# --- idempotency ---------------------------------------------------------


async def test_repeated_send_with_same_key_stores_one_message(
    client: AsyncClient, auth_headers, db_session, chat_runtime
):
    conversation_id = await _create_conversation(client, auth_headers)
    payload = {
        "conversation_id": conversation_id,
        "content": "duplicate me",
        "idempotency_key": "key-1",
    }

    first = await client.post("/api/chat/send", headers=auth_headers, json=payload)
    second = await client.post("/api/chat/send", headers=auth_headers, json=payload)

    assert first.status_code == 202
    assert second.status_code == 202
    # The retry resolves to the message the first attempt stored.
    assert first.json()["message_id"] == second.json()["message_id"]

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation_id, Message.role == "user")
        )
    ).scalar_one()
    assert count == 1
    # The retry must not run the orchestrator a second time over the same message.
    assert len(chat_runtime.dispatched) == 1


async def test_sends_without_a_key_are_not_collapsed(
    client: AsyncClient, auth_headers, db_session
):
    """Older clients omit the key; they must keep working as distinct sends."""
    conversation_id = await _create_conversation(client, auth_headers)
    payload = {"conversation_id": conversation_id, "content": "again"}

    await client.post("/api/chat/send", headers=auth_headers, json=payload)
    await client.post("/api/chat/send", headers=auth_headers, json=payload)

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation_id, Message.role == "user")
        )
    ).scalar_one()
    assert count == 2


async def test_stream_retry_with_same_key_does_not_duplicate(
    client: AsyncClient, auth_headers, db_session, monkeypatch
):
    monkeypatch.setattr(
        "routers.chat.classify_intent",
        lambda *args, **kwargs: _general_chat(),
    )
    conversation_id = await _create_conversation(client, auth_headers)
    payload = {
        "conversation_id": conversation_id,
        "content": "stream once",
        "idempotency_key": "stream-key",
    }

    with stub_ai():
        await client.post("/api/chat/stream", headers=auth_headers, json=payload)
        await client.post("/api/chat/stream", headers=auth_headers, json=payload)

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation_id, Message.role == "user")
        )
    ).scalar_one()
    assert count == 1


# --- intent handling on the SSE path ------------------------------------


async def _general_chat():
    return IntentResult(intent="general_chat", params={})


async def _create_todo_intent():
    return IntentResult(intent="create_todo", params={"title": "Buy milk"})


async def test_streaming_chat_acts_on_a_task_intent(
    client: AsyncClient, auth_headers, db_session, monkeypatch
):
    """The SSE path used to ignore intents entirely, so Android could not
    create tasks by chatting. It must now perform the action."""
    monkeypatch.setattr(
        "routers.chat.classify_intent",
        lambda *args, **kwargs: _create_todo_intent(),
    )
    conversation_id = await _create_conversation(client, auth_headers)

    with stub_ai():
        resp = await client.post(
            "/api/chat/stream",
            headers=auth_headers,
            json={"conversation_id": conversation_id, "content": "add buy milk"},
        )

    assert resp.status_code == 200

    todos = (await db_session.execute(select(Todo).where(Todo.title == "Buy milk"))).scalars().all()
    assert len(todos) == 1

    stored = (
        await db_session.execute(
            select(Message).where(
                Message.conversation_id == conversation_id,
                Message.role == "assistant",
            )
        )
    ).scalars().all()
    assert len(stored) == 1
    assert stored[0].intent == "create_todo"
    # The action's own confirmation is returned, not a chat completion.
    assert "Hello there" not in stored[0].content


async def test_general_chat_still_streams_the_completion(
    client: AsyncClient, auth_headers, db_session, monkeypatch
):
    monkeypatch.setattr(
        "routers.chat.classify_intent",
        lambda *args, **kwargs: _general_chat(),
    )
    conversation_id = await _create_conversation(client, auth_headers)

    with stub_ai(StubAI(tokens=("Hi", "!"))):
        resp = await client.post(
            "/api/chat/stream",
            headers=auth_headers,
            json={"conversation_id": conversation_id, "content": "how are you"},
        )

    tokens = [
        json.loads(p)["token"]
        for p in _sse_payloads(resp.text)
        if p != "[DONE]" and "token" in json.loads(p)
    ]
    assert "".join(tokens) == "Hi!"

    stored = (
        await db_session.execute(
            select(Message).where(
                Message.conversation_id == conversation_id,
                Message.role == "assistant",
            )
        )
    ).scalars().all()
    assert stored[0].content == "Hi!"


async def test_intent_failure_falls_back_to_chat(
    client: AsyncClient, auth_headers, monkeypatch
):
    """A classifier outage must degrade to plain chat, not break the stream."""

    async def _boom(*args, **kwargs):
        raise RuntimeError("classifier down")

    monkeypatch.setattr("routers.chat.classify_intent", _boom)
    conversation_id = await _create_conversation(client, auth_headers)

    with stub_ai(StubAI(tokens=("ok",))):
        resp = await client.post(
            "/api/chat/stream",
            headers=auth_headers,
            json={"conversation_id": conversation_id, "content": "hello"},
        )

    payloads = _sse_payloads(resp.text)
    assert payloads[-1] == "[DONE]"
    tokens = [
        json.loads(p)["token"] for p in payloads if p != "[DONE]" and "token" in json.loads(p)
    ]
    assert "".join(tokens) == "ok"
