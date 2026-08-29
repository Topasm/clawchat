"""Unified review inbox and artifact approval lifecycle tests."""

import json

import pytest

from database import _backfill_review_items
from domain.plan_proposal import PlanProposalStatus
from domain.review import ReviewRiskLevel, ReviewSubjectType
from models.agent_task import AgentTask
from models.artifact import Artifact, ArtifactRevision
from models.plan_proposal import PlanProposal
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from schemas.task import PlanPayload
from services.review import review_item_service
from sqlalchemy import select


async def create_project(client, auth_headers, title="Review project"):
    response = await client.post(
        "/api/projects", headers=auth_headers, json={"title": title}
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_artifact_revision_flows_through_unified_review(
    client, auth_headers, db_session
):
    project = await create_project(client, auth_headers)
    created = await client.post(
        f"/api/projects/{project['id']}/artifacts",
        headers=auth_headers,
        json={
            "type": "project_brief",
            "title": "Project brief",
            "content": "Version one",
        },
    )
    assert created.status_code == 201, created.text
    artifact = created.json()
    assert artifact["current_version"] == 1

    proposed = await client.post(
        f"/api/artifacts/{artifact['id']}/revisions",
        headers=auth_headers,
        json={"content": "Version two", "summary": "Update success criteria"},
    )
    assert proposed.status_code == 201, proposed.text
    assert proposed.json()["status"] == "pending"
    assert proposed.json()["version"] == 2

    queue = await client.get("/api/reviews", headers=auth_headers)
    assert queue.status_code == 200
    assert len(queue.json()) == 1
    review = queue.json()[0]
    assert review["subject_type"] == "artifact_revision"
    assert review["project_title"] == "Review project"
    assert review["metadata"]["current_version"] == 1

    overview = await client.get(
        f"/api/projects/{project['id']}", headers=auth_headers
    )
    assert overview.json()["pending_review_count"] == 1

    decided = await client.post(
        f"/api/reviews/{review['id']}/decision",
        headers=auth_headers,
        json={"decision": "approved", "note": "Looks good"},
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["review"]["status"] == "approved"
    assert decided.json()["review"]["review_note"] == "Looks good"
    stored = await db_session.get(Artifact, artifact["id"])
    await db_session.refresh(stored)
    assert stored.content == "Version two"
    assert stored.current_version == 2


@pytest.mark.asyncio
async def test_changes_requested_does_not_replace_artifact(
    client, auth_headers, db_session
):
    project = await create_project(client, auth_headers)
    artifact = (await client.post(
        f"/api/projects/{project['id']}/artifacts",
        headers=auth_headers,
        json={"type": "requirements", "title": "Requirements", "content": "Original"},
    )).json()
    revision = (await client.post(
        f"/api/artifacts/{artifact['id']}/revisions",
        headers=auth_headers,
        json={"content": "Unsafe edit"},
    )).json()
    review = (await client.get("/api/reviews", headers=auth_headers)).json()[0]

    response = await client.post(
        f"/api/reviews/{review['id']}/decision",
        headers=auth_headers,
        json={"decision": "changes_requested", "note": "Add acceptance criteria"},
    )
    assert response.status_code == 200
    stored = await db_session.get(Artifact, artifact["id"])
    stored_revision = await db_session.get(ArtifactRevision, revision["id"])
    await db_session.refresh(stored)
    await db_session.refresh(stored_revision)
    assert stored.content == "Original"
    assert stored.current_version == 1
    assert stored_revision.status == "changes_requested"

    resubmitted = await client.post(
        f"/api/artifacts/{artifact['id']}/revisions",
        headers=auth_headers,
        json={"content": "Improved edit"},
    )
    assert resubmitted.status_code == 201, resubmitted.text
    assert resubmitted.json()["id"] == revision["id"]
    pending = await client.get("/api/reviews", headers=auth_headers)
    assert pending.json()[0]["id"] == review["id"]
    assert pending.json()[0]["review_note"] is None


@pytest.mark.asyncio
async def test_plan_review_approval_uses_canonical_apply_path(
    client, auth_headers, db_session
):
    project_data = await create_project(client, auth_headers, "Planned project")
    project = await db_session.get(Project, project_data["id"])
    await db_session.refresh(project)
    payload = PlanPayload.model_validate({
        "summary": "Build the release",
        "subtasks": [{"title": "Ship reviewed task"}],
    }).model_dump(mode="json")
    agent_task = AgentTask(
        id="task_review_plan", task_type="plan_todo", agent_type="plan",
        instruction="Plan", status="completed", todo_id=project.root_task_id,
        payload_json=json.dumps(payload),
    )
    proposal = PlanProposal(
        id="proposal_review_plan", project_id=project.id,
        root_task_id=project.root_task_id, agent_task_id=agent_task.id,
        base_graph_revision=project.graph_revision,
        payload_json=json.dumps(payload),
        validation_json='{"errors": [], "warnings": []}',
        status=PlanProposalStatus.DRAFT,
    )
    db_session.add_all([agent_task, proposal])
    await db_session.flush()
    review = await review_item_service.ensure_review_item(
        db_session,
        subject_type=ReviewSubjectType.PLAN_PROPOSAL,
        subject_id=proposal.id,
        project_id=project.id,
        summary="Build the release",
        risk_level=ReviewRiskLevel.MEDIUM,
    )
    await db_session.commit()

    response = await client.post(
        f"/api/reviews/{review.id}/decision",
        headers=auth_headers,
        json={"decision": "approved"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["review"]["status"] == "approved"
    assert response.json()["outcome"]["created_subtask_ids"]
    tasks = list((await db_session.execute(select(Todo).where(
        Todo.parent_id == project.root_task_id,
        Todo.title == "Ship reviewed task",
    ))).scalars().all())
    assert len(tasks) == 1


@pytest.mark.asyncio
async def test_direct_plan_dismiss_keeps_review_queue_in_sync(
    client, auth_headers, db_session
):
    project_data = await create_project(client, auth_headers)
    project = await db_session.get(Project, project_data["id"])
    payload = PlanPayload.model_validate({
        "summary": "Dismiss me", "subtasks": [{"title": "Nope"}]
    }).model_dump(mode="json")
    task = AgentTask(
        id="task_dismiss_review", task_type="plan_todo", agent_type="plan",
        instruction="Plan", status="completed", todo_id=project.root_task_id,
        payload_json=json.dumps(payload),
    )
    proposal = PlanProposal(
        id="proposal_dismiss_review", project_id=project.id,
        root_task_id=project.root_task_id, agent_task_id=task.id,
        base_graph_revision=project.graph_revision, payload_json=json.dumps(payload),
        validation_json='{"errors": [], "warnings": []}', status="draft",
    )
    db_session.add_all([task, proposal])
    await db_session.commit()

    response = await client.post(
        f"/api/todos/{project.root_task_id}/plan/dismiss",
        headers=auth_headers,
        json={"proposal_id": proposal.id},
    )
    assert response.status_code == 200
    rejected = await client.get(
        "/api/reviews", headers=auth_headers, params={"status": "rejected"}
    )
    assert rejected.status_code == 200
    assert rejected.json()[0]["subject_id"] == proposal.id


@pytest.mark.asyncio
async def test_legacy_review_backfill_is_idempotent(db_session):
    task = AgentTask(
        id="task_legacy_review", task_type="plan_todo", agent_type="plan",
        instruction="Plan", status="completed",
    )
    proposal = PlanProposal(
        id="proposal_legacy_review", agent_task_id=task.id,
        payload_json='{"summary":"Legacy","subtasks":[]}',
        validation_json='{"errors":[],"warnings":[]}', status="stale",
        is_revertible=False,
    )
    db_session.add_all([task, proposal])
    await db_session.commit()

    await _backfill_review_items(db_session)
    await _backfill_review_items(db_session)
    await db_session.commit()

    rows = list((await db_session.execute(select(ReviewItem).where(
        ReviewItem.subject_id == proposal.id
    ))).scalars().all())
    assert len(rows) == 1
    assert rows[0].status == "expired"
