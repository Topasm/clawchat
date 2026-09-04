"""The chat knows where the agent is: in the prompt, and as an answer."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain.agent_run import AgentRunStatus
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service
from services.chat.conversation_context import build_conversation_context
from services.chat.intent_handlers import IntentContext, get_intent_handler


class FakeAI:
    model = "fake-model"

    async def generate_completion(self, *, system_prompt, user_message):
        return f"Result for {user_message}"


@pytest.fixture(autouse=True)
def silence_ws(monkeypatch):
    monkeypatch.setattr(agent_run_service, "ws_manager", SimpleNamespace(send_json=AsyncMock()))


async def seed(db_session):
    project = Project(id="project_ctx", title="Context project")
    db_session.add(project)
    await db_session.flush()
    todo_a = Todo(id="todo_ctx_a", project_id=project.id, title="Compare vendors")
    todo_b = Todo(id="todo_ctx_b", project_id=project.id, title="Draft the summary")
    other = Todo(id="todo_ctx_other", title="Unrelated errand")
    db_session.add_all([todo_a, todo_b, other])
    await db_session.flush()
    task_a = AgentTask(id="task_ctx_a", task_type="research", instruction="Compare vendors",
                       todo_id=todo_a.id, agent_type="research")
    task_b = AgentTask(id="task_ctx_b", task_type="draft", instruction="Draft the summary",
                       todo_id=todo_b.id, agent_type="draft")
    task_other = AgentTask(id="task_ctx_other", task_type="research", instruction="Errand",
                           todo_id=other.id, agent_type="research")
    db_session.add_all([task_a, task_b, task_other])
    await db_session.flush()
    waiting = await agent_run_service.create_run(db_session, task_a, provider="openclaw")
    await agent_run_service.mark_starting(db_session, waiting)
    await agent_run_service.mark_running(db_session, waiting)
    await agent_run_service.transition_run(
        db_session, waiting, AgentRunStatus.WAITING_INPUT, "Include used equipment?"
    )
    reviewable = await agent_run_service.create_run(db_session, task_b, provider="openclaw")
    await agent_task_service.execute_task(
        db_session, task_b, FakeAI(), SimpleNamespace(send_json=AsyncMock()), "user",
        run=reviewable, provider="openclaw",
    )
    elsewhere = await agent_run_service.create_run(db_session, task_other, provider="openclaw")
    await agent_run_service.mark_starting(db_session, elsewhere)
    await agent_run_service.mark_running(db_session, elsewhere)
    await agent_run_service.update_progress(db_session, elsewhere, 40, "Searching")
    await db_session.commit()
    return project, task_a


@pytest.mark.asyncio
async def test_project_chat_prompt_carries_the_agent_activity(db_session):
    project, _task_a = await seed(db_session)
    conversation = Conversation(id="conv_ctx", title="Project chat", project_id=project.id)
    db_session.add(conversation)
    await db_session.commit()

    context = await build_conversation_context(db_session, conversation)

    assert "[Project: Context project]" in context
    assert "[Agent activity]" in context
    assert "waiting for your input: Compare vendors — Include used equipment?" in context
    assert "waiting for your review: Draft the summary" in context
    assert "Results waiting for the user's review: 1" in context
    # Another project's run is not this project's business.
    assert "Unrelated errand" not in context


@pytest.mark.asyncio
async def test_a_run_thread_prompt_is_scoped_to_its_own_run(db_session):
    _project, task_a = await seed(db_session)
    thread = await db_session.get(Conversation, task_a.conversation_id)
    thread.project_id = None
    await db_session.commit()

    context = await build_conversation_context(db_session, thread)

    assert "Compare vendors" in context
    assert "Draft the summary" not in context
    assert "Unrelated errand" not in context


@pytest.mark.asyncio
async def test_asking_what_the_agent_is_doing_lists_runs_and_needs(db_session):
    await seed(db_session)
    handler = get_intent_handler("query_runs")
    assert handler is not None and handler.module_intent is False

    text, metadata = await handler.handle(
        IntentContext(db=db_session, ai=None, ws=None, intent="query_runs", params={})
    )

    assert metadata is None
    assert "Agent work (3 runs)" in text
    assert "- waiting for your input: Compare vendors — Include used equipment?" in text
    assert "- running: Unrelated errand (40%) — Searching" in text
    assert "Needs you: 1 waiting for your answer, 1 waiting for your review." in text


@pytest.mark.asyncio
async def test_asking_with_nothing_running_says_so(db_session):
    handler = get_intent_handler("query_runs")
    text, _ = await handler.handle(
        IntentContext(db=db_session, ai=None, ws=None, intent="query_runs", params={})
    )
    assert text.startswith("No agent work is running right now")
