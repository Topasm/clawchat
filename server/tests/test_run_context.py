"""Agent executions receive bounded recent conversation context."""

from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from services.agents import agent_run_service
from services.agents.run_context_service import build_execution_instruction
from services.tasks import project_service


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
    db_session.add_all(
        [
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
        ]
    )
    await db_session.flush()

    instruction = await build_execution_instruction(db_session, task)

    assert "User: Use the decision from yesterday" in instruction
    assert "Assistant: We chose the shorter format" in instruction
    assert instruction.endswith("[Task instruction]\nDraft the final note")


async def test_execution_instruction_does_not_repeat_the_triggering_message(db_session):
    conversation = Conversation(id="conv_trigger_context", title="Context")
    db_session.add(conversation)
    await db_session.flush()
    previous = Message(
        id="msg_previous_context",
        conversation_id=conversation.id,
        role="assistant",
        content="Use the approved outline.",
    )
    trigger = Message(
        id="msg_trigger_context",
        conversation_id=conversation.id,
        role="user",
        content="Draft the final note",
    )
    db_session.add_all([previous, trigger])
    await db_session.flush()
    task = AgentTask(
        id="task_trigger_context",
        task_type="draft",
        instruction=trigger.content,
        conversation_id=conversation.id,
        message_id=trigger.id,
    )
    db_session.add(task)
    await db_session.flush()

    instruction = await build_execution_instruction(db_session, task)

    assert "Assistant: Use the approved outline." in instruction
    assert "User: Draft the final note" not in instruction
    assert instruction.endswith("[Task instruction]\nDraft the final note")


async def test_project_rules_are_frozen_at_the_start_of_the_run(db_session):
    project = await project_service.create_project(
        db_session,
        title="Semantic referent binding",
        execution_instructions="Never use --force.\nSeal uncommitted results first.",
    )
    task = AgentTask(
        id="task_project_rules",
        task_type="research",
        instruction="Run E65a",
        todo_id=project.root_task_id,
    )
    db_session.add(task)
    await db_session.flush()

    run = await agent_run_service.create_run(
        db_session,
        task,
        provider="openclaw",
    )

    assert run.instruction_snapshot.startswith(
        "[Project rules]\nNever use --force.\nSeal uncommitted results first."
    )
    assert run.instruction_snapshot.endswith("[Task instruction]\nRun E65a")


async def test_empty_project_rules_do_not_add_a_block(db_session):
    project = await project_service.create_project(
        db_session,
        title="No extra rules",
        execution_instructions="   ",
    )
    task = AgentTask(
        id="task_empty_project_rules",
        task_type="draft",
        instruction="Write the note",
        todo_id=project.root_task_id,
    )
    db_session.add(task)
    await db_session.flush()

    assert await build_execution_instruction(db_session, task) == "Write the note"


async def test_project_conversation_task_receives_project_rules_without_a_todo(
    db_session,
):
    project = await project_service.create_project(
        db_session,
        title="Conversation-scoped execution",
        execution_instructions="Keep changes inside the selected project.",
    )
    conversation = Conversation(
        id="conv_project_context",
        title="Project Agent",
        project_id=project.id,
    )
    db_session.add(conversation)
    await db_session.flush()
    task = AgentTask(
        id="task_project_conversation",
        task_type="execute",
        instruction="Inspect the current branch",
        conversation_id=conversation.id,
    )
    db_session.add(task)
    await db_session.flush()

    instruction = await build_execution_instruction(db_session, task)

    assert instruction.startswith(
        "[Project rules]\nKeep changes inside the selected project."
    )
    assert instruction.endswith("[Task instruction]\nInspect the current branch")


async def test_instruction_prefix_is_not_mistaken_for_an_existing_snapshot(db_session):
    project = await project_service.create_project(
        db_session,
        title="Literal prefix",
        execution_instructions="Do not skip validation.",
    )
    task = AgentTask(
        id="task_literal_prefix",
        task_type="execute",
        instruction="[Project rules]\nThis text was written by the user.",
        todo_id=project.root_task_id,
    )
    db_session.add(task)
    await db_session.flush()

    instruction = await build_execution_instruction(db_session, task)

    assert instruction.startswith("[Project rules]\nDo not skip validation.")
    assert instruction.endswith(
        "[Task instruction]\n[Project rules]\nThis text was written by the user."
    )


async def test_supplied_run_snapshot_is_not_wrapped_again(db_session):
    project = await project_service.create_project(
        db_session,
        title="Retry context",
        execution_instructions="Use the frozen rules.",
    )
    task = AgentTask(
        id="task_retry_context",
        task_type="execute",
        instruction="Original instruction",
        todo_id=project.root_task_id,
    )
    db_session.add(task)
    await db_session.flush()
    snapshot = (
        "[Project rules]\nRules from the first attempt.\n\n"
        "[Task instruction]\nOriginal instruction\n\n"
        "Follow-up instruction:\nTry a narrower change"
    )

    run = await agent_run_service.create_run(
        db_session,
        task,
        provider="openclaw",
        instruction_snapshot=snapshot,
    )

    assert run.instruction_snapshot == snapshot
    assert task.instruction == "Original instruction"
