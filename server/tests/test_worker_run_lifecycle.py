"""Desktop worker heartbeats and results preserve the run state machine."""

from domain.agent_run import AgentRunStatus
from models.agent_task import AgentTask
from models.execution_host import ExecutionHost
from services.agents import agent_run_service


async def _running_worker_run(db_session):
    task = AgentTask(
        id="task_worker",
        task_type="code",
        instruction="Do the work",
        agent_type="code",
    )
    host = ExecutionHost(id="host_worker", label="MacBook", kind="worker")
    db_session.add_all([task, host])
    await db_session.flush()
    run = await agent_run_service.create_run(
        db_session, task, provider="worker", host_id=host.label
    )
    run.execution_host_id = host.id
    run.status = AgentRunStatus.RUNNING
    await db_session.commit()
    return run, task, host


async def test_worker_heartbeat_also_checks_in_its_execution_host(
    client, auth_headers, db_session
):
    run, _task, host = await _running_worker_run(db_session)
    previous_seen = host.last_seen_at

    response = await client.post(
        f"/api/runs/{run.id}/heartbeat",
        headers=auth_headers,
        json={"progress": 25, "message": "Still working"},
    )

    assert response.status_code == 200, response.text
    await db_session.refresh(host)
    assert host.last_seen_at is not None
    assert previous_seen is None or host.last_seen_at >= previous_seen


async def test_worker_success_updates_task_and_moves_run_to_review(
    client, auth_headers, db_session
):
    run, task, _host = await _running_worker_run(db_session)

    response = await client.post(
        f"/api/runs/{run.id}/result",
        headers=auth_headers,
        json={"result": "Finished"},
    )

    assert response.status_code == 200, response.text
    await db_session.refresh(run)
    await db_session.refresh(task)
    assert run.status == AgentRunStatus.WAITING_REVIEW
    assert task.status == "completed"
    assert task.result == "Finished"
    assert task.error is None


async def test_late_worker_result_cannot_reopen_a_failed_run(
    client, auth_headers, db_session
):
    run, task, _host = await _running_worker_run(db_session)
    run.status = AgentRunStatus.FAILED
    run.error = "No heartbeat for 10 minutes"
    task.status = "failed"
    task.error = run.error
    await db_session.commit()

    response = await client.post(
        f"/api/runs/{run.id}/result",
        headers=auth_headers,
        json={"result": "Finished late"},
    )

    assert response.status_code == 409, response.text
    await db_session.refresh(run)
    await db_session.refresh(task)
    assert run.status == AgentRunStatus.FAILED
    assert run.error == "No heartbeat for 10 minutes"
    assert task.status == "failed"
