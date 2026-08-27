"""Task-level execution telemetry aggregation tests."""

from datetime import datetime, timedelta, timezone

import pytest

from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.artifact import Artifact, ArtifactRevision
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo


async def create_project_task(db_session, suffix: str):
    project = Project(id=f"project_{suffix}", title=f"Project {suffix}")
    db_session.add(project)
    await db_session.flush()
    task = Todo(
        id=f"todo_{suffix}",
        project_id=project.id,
        title=f"Task {suffix}",
    )
    db_session.add(task)
    await db_session.flush()
    project.root_task_id = task.id
    await db_session.flush()
    return project, task


@pytest.mark.asyncio
async def test_execution_telemetry_aggregates_latest_run_reviews_and_artifacts(
    client, auth_headers, db_session
):
    project, task = await create_project_task(db_session, "telemetry")
    agent_task = AgentTask(
        id="agent_task_telemetry",
        task_type="research",
        instruction="Research",
        todo_id=task.id,
    )
    db_session.add(agent_task)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    old_run = AgentRun(
        id="run_old",
        agent_task_id=agent_task.id,
        project_id=project.id,
        attempt=1,
        instruction_snapshot="First attempt",
        provider="legacy",
        status="failed",
        progress=20,
        created_at=now - timedelta(hours=1),
        updated_at=now - timedelta(hours=1),
    )
    latest_run = AgentRun(
        id="run_latest",
        agent_task_id=agent_task.id,
        project_id=project.id,
        attempt=2,
        instruction_snapshot="Second attempt",
        provider="openclaw",
        status="waiting_review",
        progress=100,
        progress_message="Draft ready",
        created_at=now,
        updated_at=now,
    )
    artifact_old = Artifact(
        id="artifact_old",
        project_id=project.id,
        task_id=task.id,
        type="report",
        title="Old report",
        content="Old",
        updated_at=now - timedelta(minutes=5),
    )
    artifact_latest = Artifact(
        id="artifact_latest",
        project_id=project.id,
        task_id=task.id,
        type="generated_file",
        title="Latest output",
        content="Latest",
        updated_at=now,
    )
    db_session.add_all([old_run, latest_run, artifact_old, artifact_latest])
    await db_session.flush()
    revision = ArtifactRevision(
        id="revision_pending",
        artifact_id=artifact_latest.id,
        version=2,
        title="Latest output",
        content="Proposed",
        status="pending",
    )
    db_session.add(revision)
    await db_session.flush()
    db_session.add_all(
        [
            ReviewItem(
                id="review_run",
                project_id=project.id,
                subject_type="agent_run",
                subject_id=latest_run.id,
                status="pending",
                summary="Review run",
                risk_level="medium",
            ),
            ReviewItem(
                id="review_revision",
                project_id=project.id,
                subject_type="artifact_revision",
                subject_id=revision.id,
                status="pending",
                summary="Review artifact",
                risk_level="low",
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        "/api/todos/execution-telemetry", headers=auth_headers
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    latest_run_updated_at = payload[0].pop("latest_run_updated_at")
    latest_artifact_updated_at = payload[0].pop("latest_artifact_updated_at")
    assert payload == [
        {
            "task_id": task.id,
            "latest_run_id": latest_run.id,
            "latest_run_status": "waiting_review",
            "latest_run_progress": 100,
            "latest_run_provider": "openclaw",
            "latest_run_progress_message": "Draft ready",
            "pending_review_count": 2,
            "artifact_count": 2,
            "latest_artifact_id": artifact_latest.id,
            "latest_artifact_title": "Latest output",
            "latest_artifact_type": "generated_file",
        }
    ]
    assert datetime.fromisoformat(latest_run_updated_at).replace(
        tzinfo=timezone.utc
    ) == latest_run.updated_at
    assert datetime.fromisoformat(latest_artifact_updated_at).replace(
        tzinfo=timezone.utc
    ) == artifact_latest.updated_at


@pytest.mark.asyncio
async def test_execution_telemetry_project_scope_uses_current_task_project(
    client, auth_headers, db_session
):
    first_project, first_task = await create_project_task(db_session, "first")
    second_project, second_task = await create_project_task(db_session, "second")
    first_agent_task = AgentTask(
        id="agent_task_first",
        task_type="general",
        instruction="First",
        todo_id=first_task.id,
    )
    second_agent_task = AgentTask(
        id="agent_task_second",
        task_type="general",
        instruction="Second",
        todo_id=second_task.id,
    )
    db_session.add_all([first_agent_task, second_agent_task])
    await db_session.flush()
    # Keep the historical run project deliberately stale: task ownership is canonical.
    db_session.add_all(
        [
            AgentRun(
                id="run_first",
                agent_task_id=first_agent_task.id,
                project_id=second_project.id,
                attempt=1,
                instruction_snapshot="First",
                provider="local",
                status="running",
                progress=40,
            ),
            AgentRun(
                id="run_second",
                agent_task_id=second_agent_task.id,
                project_id=second_project.id,
                attempt=1,
                instruction_snapshot="Second",
                provider="local",
                status="completed",
                progress=100,
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        "/api/todos/execution-telemetry",
        headers=auth_headers,
        params={"project_id": first_project.id},
    )
    assert response.status_code == 200, response.text
    assert [item["task_id"] for item in response.json()] == [first_task.id]
    assert response.json()[0]["latest_run_id"] == "run_first"


@pytest.mark.asyncio
async def test_execution_telemetry_contract_is_in_openapi(client):
    schema = (await client.get("/openapi.json")).json()
    operation = schema["paths"]["/api/todos/execution-telemetry"]["get"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert "TaskExecutionTelemetryResponse" in schema["components"]["schemas"]
