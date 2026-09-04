"""A built-in agent can stop and ask instead of guessing, and a follow-up answers it."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from domain.review import ReviewSubjectType
from main import app
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.message import Message
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service
from services.agents.agent_task_service import ASK_USER_INSTRUCTION, parse_needs_input


class AskingAI:
    """Asks on the first call, answers once the follow-up is in the instruction."""

    model = "fake-model"

    def __init__(self):
        self.prompts: list[str] = []

    async def generate_completion(self, *, system_prompt, user_message):
        self.prompts.append(system_prompt)
        if "Follow-up instruction:" in user_message:
            return f"Draft in the tone you chose: {user_message.splitlines()[-1]}"
        return "NEEDS_INPUT: Formal or casual tone?"


async def create_project_task(db_session, *, skill_chain=None):
    project = Project(id="project_ask", title="Ask project")
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_ask", project_id=project.id, title="Write the announcement")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_ask",
        task_type="draft",
        instruction="Write the announcement",
        todo_id=todo.id,
        agent_type="draft",
        skill_chain=json.dumps(skill_chain) if skill_chain else None,
    )
    db_session.add(task)
    await db_session.flush()
    project.root_task_id = todo.id
    await db_session.commit()
    return project, todo, task


@pytest.fixture(autouse=True)
def silence_ws(monkeypatch):
    monkeypatch.setattr(agent_run_service, "ws_manager", SimpleNamespace(send_json=AsyncMock()))


def test_parse_needs_input_only_matches_the_prefix():
    assert parse_needs_input("NEEDS_INPUT: Which tone?") == "Which tone?"
    assert parse_needs_input("  NEEDS_INPUT:   Which tone?\nMore context") == (
        "Which tone?\nMore context"
    )
    assert parse_needs_input("NEEDS_INPUT:") == "The agent needs more information to continue."
    assert parse_needs_input("Here is the draft. NEEDS_INPUT: not a question") is None
    assert parse_needs_input("A normal result") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("skill_chain", [["draft"], None], ids=["skill_chain", "legacy"])
async def test_agent_question_parks_the_run_and_asks_in_the_thread(db_session, skill_chain):
    _project, _todo, task = await create_project_task(db_session, skill_chain=skill_chain)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    ai = AskingAI()
    ws = SimpleNamespace(send_json=AsyncMock())

    await agent_task_service.execute_task(
        db_session, task, ai, ws, "user", run=run, provider="openclaw"
    )

    assert all(ASK_USER_INSTRUCTION in prompt for prompt in ai.prompts)
    await db_session.refresh(run)
    assert run.status == "waiting_input"
    assert run.progress_message == "Formal or casual tone?"
    assert run.result is None
    assert task.status == "running"
    assert task.progress_message == "Formal or casual tone?"
    reviews = (await db_session.execute(select(ReviewItem).where(
        ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
        ReviewItem.subject_id == run.id,
    ))).scalars().all()
    assert reviews == []
    thread = (await db_session.execute(select(Message).where(
        Message.conversation_id == task.conversation_id
    ))).scalars().all()
    assert [message.content for message in thread] == [
        "I need your input to continue “Write the announcement”.\n\nFormal or casual tone?"
    ]
    # No completion event was announced for a question.
    assert not any(
        call.args[1]["type"] == "task_completed" for call in ws.send_json.await_args_list
    )


@pytest.mark.asyncio
async def test_follow_up_answers_the_question_and_finishes(
    client, auth_headers, db_session
):
    _project, _todo, task = await create_project_task(db_session, skill_chain=["draft"])
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    ai = AskingAI()
    await agent_task_service.execute_task(
        db_session, task, ai, SimpleNamespace(send_json=AsyncMock()), "user",
        run=run, provider="openclaw",
    )
    await db_session.refresh(run)
    assert run.status == "waiting_input"
    run_id, conversation_id = run.id, task.conversation_id

    state_names = ("active_ai", "active_ai_provider", "session_factory")
    previous = {
        name: getattr(app.state, name) for name in state_names if hasattr(app.state, name)
    }
    try:
        app.state.active_ai = ai
        app.state.active_ai_provider = "openclaw"
        app.state.session_factory = async_sessionmaker(
            db_session.bind, class_=AsyncSession, expire_on_commit=False
        )
        response = await client.post(
            f"/api/runs/{run_id}/resume",
            headers=auth_headers,
            json={"follow_up_instruction": "Casual"},
        )
        assert response.status_code == 200, response.text

        for _ in range(100):
            await asyncio.sleep(0.01)
            db_session.expire_all()
            resumed = await db_session.get(AgentRun, run_id)
            if resumed and resumed.status == "waiting_review":
                break
        else:
            pytest.fail("the answered run did not finish")
        assert resumed.result == "Draft in the tone you chose: Casual"
        assert resumed.attempt == 1
        thread = (await db_session.execute(
            select(Message).where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc(), Message.id.asc())
        )).scalars().all()
        assert [json.loads(m.metadata_json)["event_type"] for m in thread] == [
            "waiting_input", "resuming", "waiting_review",
        ]
    finally:
        for name in state_names:
            if name in previous:
                setattr(app.state, name, previous[name])
            elif hasattr(app.state, name):
                delattr(app.state, name)
