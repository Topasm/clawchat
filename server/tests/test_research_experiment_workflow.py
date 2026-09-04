"""Regression coverage for the research-branch operating contract.

The knowledge graph remains outside ClawChat.  This test pins the thin seam
that ClawChat owns: a project-scoped experiment hierarchy, frozen execution
rules, an approved report, a human-controlled completion, and the work-vault
projection.
"""

from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from domain.agent_run import AgentRunStatus
from domain.review import ReviewStatus
from domain.task import TaskStatus
from models.agent_task import AgentTask
from models.artifact import Artifact
from models.task_relationship import TaskRelationship
from models.todo import Todo
from services.agents import agent_run_service, execution_host_service
from services.tasks import project_service, todo_service


@pytest.mark.asyncio
async def test_research_experiment_moves_from_project_rules_to_work_vault(
    client,
    auth_headers,
    db_session,
    tmp_path,
):
    canonical_doc = (
        "/home/researcher/Desktop/research_graph/RESEARCH_QUESTION_MAP_ko.md"
    )
    project_rules = (
        "Seal uncommitted results before cleanup.\n"
        "Never use --force.\n"
        "Keep report artifacts in the project."
    )
    workspace_path = tmp_path / "srp_e65"
    workspace_path.mkdir()
    work_vault = tmp_path / "work"
    work_vault.mkdir()
    project = await project_service.create_project(
        db_session,
        title="P0-R Semantic referent binding",
        goal="Does the planner bind the intended semantic referent?",
        description=f"{canonical_doc}\nActive SRP experiment branch.",
        execution_instructions=project_rules,
    )
    local_host = await execution_host_service.ensure_local_host(
        db_session, label="Research workstation"
    )
    await db_session.commit()

    bind_workspace = await client.put(
        f"/api/projects/{project.id}/workspace/paths",
        json={"host_id": local_host.id, "path": str(workspace_path)},
        headers=auth_headers,
    )
    assert bind_workspace.status_code == 200, bind_workspace.text
    assert bind_workspace.json() == {
        "host_id": local_host.id,
        "host_label": "Research workstation",
        "path": str(workspace_path),
        "is_available": True,
        "is_offline": False,
        "is_unconfigured": False,
        "paths": [{"host_id": local_host.id, "path": str(workspace_path)}],
    }
    await db_session.refresh(project)

    with patch.object(todo_service.settings, "obsidian_vault_path", str(work_vault)):
        question = await todo_service.create_todo(
            db_session,
            title="E65 Semantic referent binding",
            parent_id=project.root_task_id,
            tags=["exp/E65", "branch/P0-R", "repo/srp"],
        )
        step_a = await todo_service.create_todo(
            db_session,
            title="E65a Run planner boundary probe",
            parent_id=question.id,
            tags=["exp/E65a", "branch/P0-R", "repo/srp"],
        )
        step_b = await todo_service.create_todo(
            db_session,
            title="E65b Run referent perturbation",
            parent_id=question.id,
            tags=["exp/E65b", "branch/P0-R", "repo/srp"],
        )

        assert project.description.splitlines()[0] == canonical_doc
        assert project.execution_host_id == local_host.id
        assert project.execution_workspace_path == str(workspace_path)
        workspace = await execution_host_service.resolve_workspace(db_session, project)
        assert workspace.host is not None and workspace.host.id == local_host.id
        assert workspace.path == str(workspace_path)
        assert workspace.is_available is True
        assert question.parent_id == project.root_task_id
        assert step_a.parent_id == question.id
        assert step_b.parent_id == question.id
        assert {question.project_id, step_a.project_id, step_b.project_id} == {
            project.id
        }

        agent_task = AgentTask(
            task_type="research",
            instruction="Run E65a and summarize the observed boundary.",
            todo_id=step_a.id,
            agent_type="research",
        )
        db_session.add(agent_task)
        await db_session.flush()

        run = await agent_run_service.create_run(
            db_session,
            agent_task,
            provider="openclaw",
            model="test-model",
        )

        assert run.instruction_snapshot.startswith(f"[Project rules]\n{project_rules}")
        assert run.instruction_snapshot.endswith(
            "[Task instruction]\nRun E65a and summarize the observed boundary."
        )

        run.status = AgentRunStatus.WAITING_REVIEW
        run.result = "E65a observed a stable event boundary."
        await db_session.flush()

        outcome = await agent_run_service.decide_run(
            db_session,
            run.id,
            ReviewStatus.APPROVED,
        )

        await db_session.refresh(step_a)
        assert outcome.todo_status == TaskStatus.IN_PROGRESS
        assert step_a.status == TaskStatus.IN_PROGRESS

        report = (
            await db_session.execute(
                select(Artifact).where(
                    Artifact.created_by == run.id,
                    Artifact.type == "report",
                )
            )
        ).scalar_one()
        assert report.project_id == project.id
        assert report.task_id == step_a.id
        assert report.content == run.result

        relationship_count = (
            await db_session.execute(select(func.count(TaskRelationship.id)))
        ).scalar_one()
        assert relationship_count == 0

        await db_session.commit()

        scoped = await client.get(
            "/api/todos",
            params={"project_id": project.id, "limit": 100},
            headers=auth_headers,
        )
        assert scoped.status_code == 200, scoped.text
        scoped_ids = {item["id"] for item in scoped.json()["items"]}
        assert scoped_ids == {
            project.root_task_id,
            question.id,
            step_a.id,
            step_b.id,
        }

        complete = await client.patch(
            f"/api/todos/{step_a.id}",
            json={"status": TaskStatus.COMPLETED.value},
            headers=auth_headers,
        )
        assert complete.status_code == 200, complete.text
        assert complete.json()["status"] == TaskStatus.COMPLETED

        deferred_verdict = await client.post(
            "/api/task-comments",
            json={"todo_id": step_a.id, "content": "판정 미기록"},
            headers=auth_headers,
        )
        assert deferred_verdict.status_code == 201, deferred_verdict.text

    todo_file = work_vault / project.title / "TODO.md"
    content = todo_file.read_text(encoding="utf-8")
    assert content.count("<!-- claw:") == 3
    assert "- [ ] E65 Semantic referent binding" in content
    assert "- [x] E65a Run planner boundary probe" in content
    assert "#exp/E65a #branch/P0-R #repo/srp" in content
    assert "- [ ] E65b Run referent perturbation" in content

    comments = await client.get(
        "/api/task-comments",
        params={"todo_ids": step_a.id},
        headers=auth_headers,
    )
    assert comments.status_code == 200, comments.text
    assert [item["content"] for item in comments.json()] == ["판정 미기록"]

    persisted_step = await db_session.get(Todo, step_a.id)
    await db_session.refresh(persisted_step)
    assert persisted_step.status == TaskStatus.COMPLETED
