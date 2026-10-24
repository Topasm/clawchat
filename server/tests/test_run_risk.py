"""Review risk tells apart a run that never left its prompt from one that only
looked things up, and keeps anything that could have changed something asked about."""

import json
from datetime import datetime, timezone

from domain.review import ReviewRiskLevel
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.agent_tools import AgentToolCall
from services.review import run_risk


async def _run(db, *, chain=("research",), usage=None) -> tuple[AgentRun, AgentTask]:
    task = AgentTask(
        task_type="skill",
        instruction="Find out",
        agent_type=chain[0],
        skill_chain=json.dumps(list(chain)),
        status="running",
    )
    db.add(task)
    await db.flush()
    run = AgentRun(
        agent_task_id=task.id,
        attempt=1,
        instruction_snapshot="Find out",
        provider="openai",
        status="running",
        usage_json=json.dumps(usage) if usage is not None else None,
    )
    db.add(run)
    await db.flush()
    return run, task


async def _event(
    db, run: AgentRun, event_type: str, payload: dict | None = None, *, sequence: int = 1
) -> None:
    db.add(
        AgentRunEvent(
            run_id=run.id,
            sequence=sequence,
            event_type=event_type,
            payload_json=json.dumps(payload) if payload is not None else None,
        )
    )
    await db.flush()


async def _call(db, run: AgentRun, tool_name: str, *, decided: bool = False) -> None:
    db.add(
        AgentToolCall(
            run_id=run.id,
            tool_name=tool_name,
            status="succeeded",
            decided_at=datetime.now(timezone.utc) if decided else None,
        )
    )
    await db.flush()


async def test_a_run_that_never_left_its_prompt_is_low(db_session):
    run, task = await _run(db_session)
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.LOW


async def test_web_search_through_the_gateway_is_read_only_tools_not_low(db_session):
    # Brokered calls are rows, not run events; they used to leave the run looking low.
    run, task = await _run(db_session)
    await _call(db_session, run, "web_search")
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.READ_ONLY_TOOLS


async def test_a_server_the_user_marked_read_only_counts_as_a_lookup(db_session):
    run, task = await _run(db_session)
    await _call(db_session, run, "notes__search")
    await _call(db_session, run, "vault_read")
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.READ_ONLY_TOOLS


async def test_a_call_that_needed_permission_is_asked_about(db_session):
    run, task = await _run(db_session)
    await _call(db_session, run, "web_search")
    await _call(db_session, run, "jira__create_issue", decided=True)
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM


async def test_proposing_a_vault_task_is_a_change_not_a_lookup(db_session):
    run, task = await _run(db_session)
    await _call(db_session, run, "vault_add_task")
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM


async def test_opencode_reads_are_lookups_and_anything_else_is_not(db_session):
    run, task = await _run(db_session, usage={"tool_calls": 2})
    await _event(db_session, run, "tool_call", {"tool": "read"})
    await _event(db_session, run, "tool_call", {"tool": "grep"}, sequence=2)
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.READ_ONLY_TOOLS

    run, task = await _run(db_session, usage={"tool_calls": 2})
    await _event(db_session, run, "tool_call", {"tool": "read"})
    await _event(db_session, run, "tool_call", {"tool": "bash"}, sequence=2)
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM


async def test_opencode_calls_beyond_the_recorded_ones_are_unknown(db_session):
    run, task = await _run(db_session, usage={"tool_calls": 3})
    await _event(db_session, run, "tool_call", {"tool": "read"})
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM


async def test_a_permission_request_from_any_executor_is_asked_about(db_session):
    run, task = await _run(db_session)
    await _event(db_session, run, "waiting_permission")
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM


async def test_recorded_file_changes_are_never_a_lookup(db_session):
    run, task = await _run(
        db_session, usage={"files": [{"file": "report.md", "status": "modified"}]}
    )
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM


async def test_the_chain_decides_before_the_tools_do(db_session):
    run, task = await _run(db_session, chain=("draft",))
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.MEDIUM
    run, task = await _run(db_session, chain=("research", "obsidian_sync"))
    await _call(db_session, run, "web_search")
    assert await run_risk.assess(db_session, run, task) == ReviewRiskLevel.HIGH
