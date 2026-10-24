"""Agent executions receive bounded recent conversation context."""

import json

import pytest
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from services.agents import agent_run_service
from services.agents.run_context_service import (
    build_execution_instruction,
    skill_chain_block,
    snapshot_for_provider,
)
from services.tasks import project_service
from skills import get_skill


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


def _chain_task(task_id: str, chain: list[str]) -> AgentTask:
    return AgentTask(
        id=task_id,
        task_type="delegate_" + chain[0],
        instruction="Review the retry change",
        skill_chain=json.dumps(chain),
    )


@pytest.mark.parametrize("provider", ["worker", "paseo"])
async def test_cli_handoff_runs_carry_the_skill_instructions(db_session, provider):
    task = _chain_task(f"task_skill_{provider}", ["code_review"])
    db_session.add(task)
    await db_session.flush()

    run = await agent_run_service.create_run(db_session, task, provider=provider)

    skill = get_skill("code_review")
    assert run.instruction_snapshot == (
        f"[Skill: code-review]\n{skill.system_prompt.strip()}\n\n"
        "[Task instruction]\nReview the retry change"
    )


async def test_server_side_runs_leave_skills_to_the_chain(db_session):
    task = _chain_task("task_skill_server", ["code_review"])
    db_session.add(task)
    await db_session.flush()

    run = await agent_run_service.create_run(db_session, task, provider="codex_cli")

    assert run.instruction_snapshot == "Review the retry change"


async def test_a_skill_chain_travels_in_order(db_session):
    task = _chain_task("task_skill_chain", ["research", "code_review", "missing_skill"])
    db_session.add(task)
    await db_session.flush()

    instruction = await build_execution_instruction(
        db_session, task, include_skills=True
    )

    assert instruction.startswith("[Skills]\nApply these skills in order")
    assert instruction.index("[Skill: research]") < instruction.index(
        "[Skill: code-review]"
    )
    assert "missing" not in instruction
    assert instruction.endswith("[Task instruction]\nReview the retry change")


def _skill_block() -> str:
    return skill_chain_block(_chain_task("task_block", ["code_review"]))


def test_a_retry_on_the_server_drops_the_skill_text_a_worker_carried():
    task = _chain_task("task_retry_server", ["code_review"])
    worker_snapshot = (
        f"[Project rules]\nKeep PRs small\n\n{_skill_block()}\n\n"
        "[Recent conversation]\nUser: go\n\n"
        "[Task instruction]\nReview the retry change\n\nFollow-up instruction:\nAgain"
    )

    assert snapshot_for_provider(worker_snapshot, task, "codex_cli") == (
        "[Project rules]\nKeep PRs small\n\n"
        "[Recent conversation]\nUser: go\n\n"
        "[Task instruction]\nReview the retry change\n\nFollow-up instruction:\nAgain"
    )
    assert snapshot_for_provider(worker_snapshot, task, "opencode") == (
        snapshot_for_provider(worker_snapshot, task, "codex_cli")
    )


@pytest.mark.parametrize("provider", ["worker", "paseo"])
def test_a_retry_on_a_cli_host_adds_the_skill_text_a_server_run_lacked(provider):
    task = _chain_task("task_retry_cli", ["code_review"])
    server_snapshot = (
        "[Project rules]\nKeep PRs small\n\n"
        "[Recent conversation]\nUser: go\n\n"
        "[Task instruction]\nReview the retry change"
    )

    assert snapshot_for_provider(server_snapshot, task, provider) == (
        f"[Project rules]\nKeep PRs small\n\n{_skill_block()}\n\n"
        "[Recent conversation]\nUser: go\n\n"
        "[Task instruction]\nReview the retry change"
    )


def test_the_skill_text_goes_before_the_task_when_there_is_no_conversation():
    task = _chain_task("task_retry_bare", ["code_review"])

    assert snapshot_for_provider("Review the retry change", task, "worker") == (
        f"{_skill_block()}\n\n[Task instruction]\nReview the retry change"
    )
    assert snapshot_for_provider(
        "[Project rules]\nKeep PRs small\n\n[Task instruction]\nReview the retry change",
        task,
        "worker",
    ) == (
        f"[Project rules]\nKeep PRs small\n\n{_skill_block()}\n\n"
        "[Task instruction]\nReview the retry change"
    )


def test_a_matching_snapshot_and_a_task_without_skills_are_left_alone():
    task = _chain_task("task_retry_same", ["code_review"])
    worker_snapshot = f"{_skill_block()}\n\n[Task instruction]\nReview the retry change"
    assert snapshot_for_provider(worker_snapshot, task, "worker") == worker_snapshot
    assert snapshot_for_provider("Review the retry change", task, "codex_cli") == (
        "Review the retry change"
    )

    bare = AgentTask(id="task_no_chain", task_type="research", instruction="Look it up")
    assert snapshot_for_provider("Look it up", bare, "worker") == "Look it up"
