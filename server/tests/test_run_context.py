"""Agent executions receive bounded recent conversation context."""

from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from services.agents.run_context_service import build_execution_instruction


async def test_execution_instruction_contains_recent_thread_before_task(db_session):
    conversation = Conversation(id="conv_context", title="Context")
    db_session.add(conversation)
    await db_session.flush()
    task = AgentTask(
        id="task_context",
        task_type="draft",
        instruction="Draft the final note",
        conversation_id=conversation.id,
    )
    db_session.add(task)
    await db_session.flush()
    db_session.add_all([
        Message(
            conversation_id=conversation.id,
            role="user",
            content="Use the decision from yesterday",
        ),
        Message(
            conversation_id=conversation.id,
            role="assistant",
            content="We chose the shorter format",
        ),
    ])
    await db_session.flush()

    instruction = await build_execution_instruction(db_session, task)

    assert "User: Use the decision from yesterday" in instruction
    assert "Assistant: We chose the shorter format" in instruction
    assert instruction.endswith("[Task instruction]\nDraft the final note")
