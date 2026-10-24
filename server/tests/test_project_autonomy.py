"""A project's autonomy policy starts ready tasks without a click."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select

from config import settings
from domain.agent_run import AgentRunStatus
from domain.plan_proposal import PlanProposalStatus
from domain.project import ProjectAutonomy
from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType
from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.execution_host import ExecutionHost, ProjectHostPath
from models.message import Message
from models.plan_proposal import PlanProposal
from models.project import Project
from models.review_item import ReviewItem
from models.task_relationship import TaskRelationship
from models.todo import Todo
from schemas.task import PlanApplyRequest, PlanPayload
from services.agents import agent_run_service
from services.automation import project_autonomy_service as policy
from services.planning import plan_proposal_service
from services.review import review_item_service, run_risk


class ReportingAI:
    model = "fake-model"

    async def generate_completion(self, *, system_prompt, user_message):
        return "Summary: the notices mention one deadline next week."


@pytest_asyncio.fixture(autouse=True)
async def policy_runtime(session_factory):
    """Hand the policy the process state lifespan would, and take it back."""
    policy.configure(
        SimpleNamespace(
            session_factory=session_factory,
            active_ai=ReportingAI(),
            active_ai_provider="openclaw",
        )
    )
    try:
        yield
    finally:
        policy.configure(None)


@pytest.fixture
def captured_launches(monkeypatch):
    """Keep policy-started runs from executing: these tests look at starts."""
    launched: list[str] = []

    def _capture(run_id, coroutine):
        launched.append(run_id)
        coroutine.close()

    monkeypatch.setattr(agent_run_service, "launch_execution", _capture)
    return launched


async def _project(
    db,
    *,
    autonomy: str = ProjectAutonomy.AUTO_START,
    chain: list[str] | None = None,
    leaves: int = 2,
) -> str:
    """A project with ``leaves`` ready tasks and one task waiting on the first; its id."""
    root = Todo(id="todo_root", title="Launch", status=TaskStatus.PENDING, source="project_root")
    db.add(root)
    await db.flush()
    ready = [
        Todo(id=f"todo_ready_{index}", title=f"Step {index}", parent_id=root.id, sort_order=index)
        for index in range(leaves)
    ]
    blocked = Todo(id="todo_blocked", title="Publish", parent_id=root.id, sort_order=leaves)
    db.add_all([*ready, blocked])
    await db.flush()
    db.add(
        TaskRelationship(
            id="rel_publish_step0",
            source_task_id=blocked.id,
            target_task_id=ready[0].id,
            type=TaskRelationshipType.DEPENDS_ON,
        )
    )
    project = Project(
        id="proj_launch",
        title="Launch",
        root_task_id=root.id,
        autonomy=autonomy,
        default_skill_chain=json.dumps(chain if chain is not None else ["summarize"]),
    )
    db.add(project)
    await db.flush()
    for todo in (root, *ready, blocked):
        todo.project_id = project.id
    await db.commit()
    return project.id


async def _runs(db) -> list[AgentRun]:
    db.expire_all()
    return list((await db.execute(select(AgentRun).order_by(AgentRun.created_at))).scalars())


async def _settled(db, run_id: str) -> AgentRun:
    for _ in range(300):
        await asyncio.sleep(0.01)
        db.expire_all()
        run = await db.get(AgentRun, run_id)
        if (
            run.status not in (AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING)
            and not agent_run_service.is_execution_registered(run_id)
        ):
            return run
    raise AssertionError("the policy-started run did not finish")


async def _review_for(db, run_id: str) -> ReviewItem:
    return (
        await db.execute(
            select(ReviewItem).where(
                ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
                ReviewItem.subject_id == run_id,
            )
        )
    ).scalar_one()


async def _policy_notes(db) -> list[Message]:
    return list(
        (
            await db.execute(
                select(Message).where(Message.message_type == policy.POLICY_MESSAGE_TYPE)
            )
        ).scalars()
    )


# --- manual, auto_start -----------------------------------------------------


async def test_a_manual_project_starts_nothing(db_session, captured_launches):
    project_id = await _project(db_session, autonomy=ProjectAutonomy.MANUAL)

    started = await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled")

    assert started == [] and captured_launches == []
    assert await _runs(db_session) == []
    assert (await db_session.get(Todo, "todo_ready_0")).status == TaskStatus.PENDING


async def test_auto_start_starts_each_ready_leaf_exactly_once(db_session, captured_launches):
    project_id = await _project(db_session, chain=["research", "summarize"])

    started = await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled")

    runs = await _runs(db_session)
    assert len(started) == len(runs) == len(captured_launches) == 2
    by_todo = {}
    for run in runs:
        task = await db_session.get(AgentTask, run.agent_task_id)
        by_todo[task.todo_id] = (run, task)
    # The ready leaves start; the blocked one and the root do not.
    assert set(by_todo) == {"todo_ready_0", "todo_ready_1"}
    for todo_id, (run, task) in by_todo.items():
        assert run.project_id == project_id and run.status == AgentRunStatus.QUEUED
        assert json.loads(task.skill_chain) == ["research", "summarize"]
        assert json.loads(task.payload_json) == {
            "provenance": "policy",
            "project_id": project_id,
            "trigger": "policy_enabled",
            "started_at": json.loads(task.payload_json)["started_at"],
        }
        assert (await db_session.get(Todo, todo_id)).status == TaskStatus.IN_PROGRESS
        response = await agent_run_service.build_run_response(db_session, run)
        assert response.provenance == "policy"
    assert (await db_session.get(Todo, "todo_blocked")).status == TaskStatus.PENDING

    # A second trigger finds the leaves claimed and starts nothing again.
    again = await policy.start_ready_tasks(db_session, project_id, trigger="review_approved")
    assert again == [] and len(await _runs(db_session)) == 2


async def test_a_chain_that_would_plan_is_never_started(db_session, captured_launches):
    project_id = await _project(db_session, chain=["plan"])

    assert await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled") == []
    assert await _runs(db_session) == []


async def test_an_approved_result_starts_what_it_freed(db_session, session_factory):
    project_id = await _project(db_session, leaves=1)

    (run_id,) = await policy.start_ready_tasks(
        db_session, project_id, trigger="policy_enabled"
    )
    run = await _settled(db_session, run_id)
    # auto_start parks every result in Review, however low the risk.
    assert run.status == AgentRunStatus.WAITING_REVIEW and not run.is_adopted
    review = await _review_for(db_session, run_id)
    assert (review.status, review.risk_level) == (ReviewStatus.PENDING, ReviewRiskLevel.LOW)
    response = await review_item_service.build_review_response(db_session, review)
    assert response.metadata["policy"] == {
        "project_id": project_id,
        "trigger": "policy_enabled",
        "auto_approved": False,
    }
    assert (await db_session.get(Todo, "todo_blocked")).status == TaskStatus.PENDING

    outcome = await agent_run_service.decide_run(
        db_session, run_id, ReviewStatus.APPROVED, expected_status=AgentRunStatus.WAITING_REVIEW
    )
    await db_session.commit()

    assert [task.id for task in outcome.newly_ready_tasks] == ["todo_blocked"]
    runs = await _runs(db_session)
    assert len(runs) == 2
    follow_up = next(run for run in runs if run.id != run_id)
    task = await db_session.get(AgentTask, follow_up.agent_task_id)
    assert task.todo_id == "todo_blocked"
    assert json.loads(task.payload_json)["trigger"] == "review_approved"
    assert (await db_session.get(Todo, "todo_blocked")).status == TaskStatus.IN_PROGRESS
    await _settled(db_session, follow_up.id)


async def test_an_applied_plan_starts_its_steps(db_session, captured_launches):
    root = Todo(id="todo_root", title="Launch", status=TaskStatus.PENDING, source="project_root")
    db_session.add(root)
    await db_session.flush()
    project = Project(
        id="proj_plan",
        title="Launch",
        root_task_id=root.id,
        autonomy=ProjectAutonomy.AUTO_START,
        default_skill_chain=json.dumps(["summarize"]),
    )
    db_session.add(project)
    await db_session.flush()
    root.project_id = project.id
    payload = PlanPayload.model_validate(
        {
            "summary": "Plan",
            "subtasks": [
                {"title": "Collect notices"},
                {"title": "Write the digest", "depends_on_indices": [0]},
            ],
        }
    ).model_dump(mode="json")
    db_session.add(
        AgentTask(
            id="task_plan",
            task_type="plan_todo",
            agent_type="plan",
            instruction="Plan",
            status="completed",
            todo_id=root.id,
            payload_json=json.dumps(payload),
        )
    )
    proposal = PlanProposal(
        id="proposal_launch",
        project_id=project.id,
        root_task_id=root.id,
        agent_task_id="task_plan",
        base_graph_revision=project.graph_revision,
        payload_json=json.dumps(payload),
        validation_json='{"errors": [], "warnings": []}',
        status=PlanProposalStatus.DRAFT,
    )
    db_session.add(proposal)
    await db_session.commit()
    db_session.expire_all()
    proposal = await db_session.get(PlanProposal, "proposal_launch")
    proposal.base_graph_revision = (await db_session.get(Project, "proj_plan")).graph_revision
    await db_session.commit()
    base_revision = proposal.base_graph_revision

    applied, _job = await plan_proposal_service.apply_proposal(
        db_session,
        "todo_root",
        PlanApplyRequest(proposal_id="proposal_launch", base_graph_revision=base_revision),
    )

    runs = await _runs(db_session)
    assert len(runs) == 1
    task = await db_session.get(AgentTask, runs[0].agent_task_id)
    first, second = applied.created_subtask_ids
    assert task.todo_id == first
    assert json.loads(task.payload_json)["trigger"] == "plan_applied"
    assert (await db_session.get(Todo, second)).status == TaskStatus.PENDING


# --- what the policy refuses ------------------------------------------------


async def test_an_unreachable_host_starts_nothing_and_says_so_once(
    db_session, captured_launches
):
    project_id = await _project(db_session)
    host = ExecutionHost(
        id="host_laptop",
        label="Laptop",
        kind="worker",
        is_enabled=True,
        last_seen_at=datetime.now(timezone.utc) - timedelta(hours=3),
    )
    db_session.add(host)
    await db_session.flush()
    db_session.add(ProjectHostPath(project_id=project_id, host_id=host.id, path="/work/launch"))
    (await db_session.get(Project, project_id)).execution_host_id = host.id
    await db_session.commit()

    assert await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled") == []
    assert await policy.start_ready_tasks(db_session, project_id, trigger="review_approved") == []

    assert await _runs(db_session) == []
    assert (await db_session.get(Todo, "todo_ready_0")).status == TaskStatus.PENDING
    notes = await _policy_notes(db_session)
    assert len(notes) == 1
    assert "Laptop is off" in notes[0].content
    assert json.loads(notes[0].metadata_json)["kind"] == "host_offline"
    # The note lives in the project's own thread.
    from models.conversation import Conversation

    thread = await db_session.get(Conversation, notes[0].conversation_id)
    assert (thread.project_id, thread.project_todo_id) == (project_id, "todo_root")


async def test_the_daily_cap_stops_the_policy_with_one_note(
    db_session, captured_launches, monkeypatch
):
    monkeypatch.setattr(settings, "project_autonomy_daily_cap", 1)
    project_id = await _project(db_session, leaves=3)

    started = await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled")
    again = await policy.start_ready_tasks(db_session, project_id, trigger="review_approved")

    assert len(started) == 1 and again == []
    assert len(await _runs(db_session)) == 1
    assert await policy.started_today(db_session, project_id) == 1
    notes = await _policy_notes(db_session)
    assert len(notes) == 1 and "daily limit" in notes[0].content
    assert json.loads(notes[0].metadata_json)["kind"] == "daily_cap"


# --- auto_start_and_accept --------------------------------------------------


async def _accepting_project(db) -> str:
    return await _project(db, autonomy=ProjectAutonomy.AUTO_START_AND_ACCEPT, leaves=1)


async def test_auto_accept_adopts_a_low_risk_result_and_carries_on(db_session):
    project_id = await _accepting_project(db_session)

    (run_id,) = await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled")
    run = await _settled(db_session, run_id)

    assert run.status == AgentRunStatus.COMPLETED and run.is_adopted
    assert (await db_session.get(Todo, "todo_ready_0")).status == TaskStatus.COMPLETED
    review = await _review_for(db_session, run_id)
    assert (review.status, review.risk_level) == (ReviewStatus.APPROVED, ReviewRiskLevel.LOW)
    assert review.review_note == policy.POLICY_APPROVED_NOTE
    response = await review_item_service.build_review_response(db_session, review)
    assert response.metadata["policy"]["auto_approved"] is True
    # Adopting the result freed the next step, and the policy started it.
    runs = await _runs(db_session)
    assert len(runs) == 2
    follow_up = next(item for item in runs if item.id != run_id)
    task = await db_session.get(AgentTask, follow_up.agent_task_id)
    assert task.todo_id == "todo_blocked"
    await _settled(db_session, follow_up.id)


async def test_auto_accept_adopts_a_result_that_only_looked_things_up(
    db_session, monkeypatch
):
    async def looked_things_up(db, run, task):
        return ReviewRiskLevel.READ_ONLY_TOOLS

    monkeypatch.setattr(run_risk, "assess", looked_things_up)
    project_id = await _accepting_project(db_session)

    (run_id,) = await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled")
    run = await _settled(db_session, run_id)

    assert run.status == AgentRunStatus.COMPLETED and run.is_adopted
    review = await _review_for(db_session, run_id)
    assert (review.status, review.risk_level) == (
        ReviewStatus.APPROVED,
        ReviewRiskLevel.READ_ONLY_TOOLS,
    )
    assert review.review_note == policy.POLICY_APPROVED_NOTE
    follow_up = next(item for item in await _runs(db_session) if item.id != run_id)
    await _settled(db_session, follow_up.id)


@pytest.mark.parametrize("risk", [ReviewRiskLevel.MEDIUM, ReviewRiskLevel.HIGH])
async def test_auto_accept_leaves_a_riskier_result_waiting(db_session, monkeypatch, risk):
    async def could_have_changed_something(db, run, task):
        return risk

    monkeypatch.setattr(run_risk, "assess", could_have_changed_something)
    project_id = await _accepting_project(db_session)

    (run_id,) = await policy.start_ready_tasks(db_session, project_id, trigger="policy_enabled")
    run = await _settled(db_session, run_id)

    assert run.status == AgentRunStatus.WAITING_REVIEW and not run.is_adopted
    review = await _review_for(db_session, run_id)
    assert (review.status, review.risk_level) == (ReviewStatus.PENDING, risk)
    assert review.review_note is None
    assert (await db_session.get(Todo, "todo_blocked")).status == TaskStatus.PENDING
    assert len(await _runs(db_session)) == 1


async def test_a_run_a_person_started_is_not_adopted_by_the_policy(
    db_session, session_factory
):
    """auto_start_and_accept covers the policy's own runs, not a person's."""
    project_id = await _accepting_project(db_session)
    todo = await db_session.get(Todo, "todo_ready_0")
    task = AgentTask(
        id="task_by_hand",
        task_type="delegate_summarize",
        agent_type="summarize",
        instruction="Handle: Step 0",
        todo_id=todo.id,
        skill_chain=json.dumps(["summarize"]),
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    await db_session.refresh(run)
    assert run.project_id == project_id

    run_id = run.id
    await agent_run_service.mark_waiting_review(db_session, run, task, "Done by hand.")
    await db_session.commit()

    db_session.expire_all()
    run = await db_session.get(AgentRun, run_id)
    assert run.status == AgentRunStatus.WAITING_REVIEW
    review = await _review_for(db_session, run_id)
    assert (review.status, review.risk_level) == (ReviewStatus.PENDING, ReviewRiskLevel.LOW)
    assert "policy" not in (
        await review_item_service.build_review_response(db_session, review)
    ).metadata


# --- the API ----------------------------------------------------------------


async def test_the_project_api_carries_the_policy(client, auth_headers, db_session):
    created = (
        await client.post(
            "/api/projects", headers=auth_headers, json={"title": "Launch"}
        )
    ).json()
    assert (created["autonomy"], created["default_skill_chain"]) == ("manual", None)

    needs_chain = await client.patch(
        f"/api/projects/{created['id']}", headers=auth_headers, json={"autonomy": "auto_start"}
    )
    assert needs_chain.status_code == 400, needs_chain.text
    assert needs_chain.json()["error"]["details"]["reason"] == "skill_chain_required"

    no_plan = await client.patch(
        f"/api/projects/{created['id']}",
        headers=auth_headers,
        json={"autonomy": "auto_start", "default_skill_chain": ["plan"]},
    )
    assert no_plan.status_code == 400, no_plan.text
    assert no_plan.json()["error"]["details"]["reason"] == "plan_in_skill_chain"

    unknown = await client.patch(
        f"/api/projects/{created['id']}",
        headers=auth_headers,
        json={"default_skill_chain": ["summarize", "nope"]},
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["error"]["details"]["skills"] == ["nope"]

    updated = await client.patch(
        f"/api/projects/{created['id']}",
        headers=auth_headers,
        json={"autonomy": "auto_start_and_accept", "default_skill_chain": ["research", "summarize"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["autonomy"] == "auto_start_and_accept"
    assert updated.json()["default_skill_chain"] == ["research", "summarize"]
    listed = (await client.get("/api/projects", headers=auth_headers)).json()
    assert listed[0]["default_skill_chain"] == ["research", "summarize"]

    back_to_manual = await client.patch(
        f"/api/projects/{created['id']}", headers=auth_headers, json={"autonomy": "manual"}
    )
    assert back_to_manual.status_code == 200
    assert back_to_manual.json()["autonomy"] == "manual"
    # The chain stays recorded for the next time the policy is switched on.
    assert back_to_manual.json()["default_skill_chain"] == ["research", "summarize"]


async def test_switching_the_policy_on_starts_what_is_ready(
    client, auth_headers, db_session, captured_launches
):
    project_id = await _project(db_session, autonomy=ProjectAutonomy.MANUAL)

    response = await client.patch(
        f"/api/projects/{project_id}", headers=auth_headers, json={"autonomy": "auto_start"}
    )

    assert response.status_code == 200, response.text
    assert len(await _runs(db_session)) == 2
    assert len(captured_launches) == 2
