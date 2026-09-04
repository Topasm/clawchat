"""A project's folder describes itself to chat and to runs through its worker.

The server never reads another machine's disk. The worker on the machine that
holds the folder sends a bounded snapshot of its README-like files, and from
then on both the project chat and every execution instruction know what the
folder is for.
"""

from datetime import datetime, timezone

import pytest

from exceptions import ValidationError
from models.agent_task import AgentTask
from models.execution_host import ExecutionHost, ProjectHostPath
from services.agents import execution_host_service
from services.agents.run_context_service import build_execution_instruction
from services.chat.conversation_context import build_first_class_project_context
from services.tasks import project_service


async def _worker_project(db, *, path="/home/me/srp_e65"):
    host = ExecutionHost(
        label="ubuntu-lab",
        kind="worker",
        last_seen_at=datetime.now(timezone.utc),
    )
    db.add(host)
    await db.flush()
    project = await project_service.create_project(db, title="E65 experiments")
    db.add(ProjectHostPath(project_id=project.id, host_id=host.id, path=path))
    project.execution_host_id = host.id
    await db.flush()
    return host, project


async def test_snapshot_is_bounded_per_file_and_in_total(db_session):
    host, project = await _worker_project(db_session)
    big = "x" * 30_000

    row = await execution_host_service.store_workspace_context(
        db_session,
        project.id,
        host.id,
        [
            ("README.md", "# E65\nSweeps over the seed."),
            ("docs/INDEX.md", big),
            ("WORKSPACE_INDEX.md", big),
            ("W.md", big),
        ],
    )

    assert row.context_updated_at is not None
    assert "# E65" in row.context_text
    # Each big file is cut to its ceiling; the last no longer fits the total
    # and is dropped whole, so the file list only names what the text contains.
    assert row.context_text.count("…(truncated)") == 2
    assert len(row.context_text) <= execution_host_service.MAX_CONTEXT_TOTAL_CHARS
    assert execution_host_service.context_file_names(row) == [
        "README.md",
        "docs/INDEX.md",
        "WORKSPACE_INDEX.md",
    ]


async def test_snapshot_needs_a_recorded_path(db_session):
    host, project = await _worker_project(db_session)
    other = ExecutionHost(label="MacBook", kind="worker")
    db_session.add(other)
    await db_session.flush()

    with pytest.raises(ValidationError):
        await execution_host_service.store_workspace_context(
            db_session, project.id, other.id, [("README.md", "hello")]
        )


async def test_execution_instruction_carries_the_workspace_block(db_session):
    host, project = await _worker_project(db_session)
    project.execution_instructions = "Never use --force."
    await execution_host_service.store_workspace_context(
        db_session, project.id, host.id, [("README.md", "Runs live in runs/<id>.")]
    )
    task = AgentTask(
        task_type="research",
        instruction="Compare seed 3 against seed 4",
        todo_id=project.root_task_id,
    )
    db_session.add(task)
    await db_session.flush()

    instruction = await build_execution_instruction(db_session, task)

    rules = instruction.index("[Project rules]")
    workspace = instruction.index("[Workspace ubuntu-lab: /home/me/srp_e65]")
    assert rules < workspace < instruction.index("[Task instruction]")
    assert "Runs live in runs/<id>." in instruction


async def test_project_chat_sees_a_shorter_copy_of_the_folder(db_session):
    host, project = await _worker_project(db_session)
    await execution_host_service.store_workspace_context(
        db_session, project.id, host.id, [("README.md", "Layout:\n" + "y" * 7_000)]
    )

    context = await build_first_class_project_context(db_session, project.id)

    assert "[Workspace ubuntu-lab: /home/me/srp_e65]" in context
    assert "Layout:" in context
    assert "…(truncated)" in context
    assert len(context) < 6_000


async def test_a_bound_folder_without_a_snapshot_still_names_itself(db_session):
    host, project = await _worker_project(db_session)

    block = await execution_host_service.workspace_context_block(db_session, project)

    assert block == "[Workspace ubuntu-lab: /home/me/srp_e65]"
    unbound = await project_service.create_project(db_session, title="Nowhere")
    assert await execution_host_service.workspace_context_block(db_session, unbound) == ""


async def test_claimed_job_names_its_project(db_session):
    from domain.agent_run import AgentRunStatus
    from models.agent_run import AgentRun

    host, project = await _worker_project(db_session)
    task = AgentTask(task_type="research", instruction="Go", todo_id=project.root_task_id)
    db_session.add(task)
    await db_session.flush()
    run = AgentRun(
        agent_task_id=task.id,
        project_id=project.id,
        attempt=1,
        instruction_snapshot="Go",
        status=AgentRunStatus.QUEUED,
        execution_host_id=host.id,
        provider="worker",
    )
    db_session.add(run)
    await db_session.flush()

    job = await execution_host_service.claim_next_job(db_session, host)

    assert job is not None
    assert job.project_id == project.id
    assert job.cwd == "/home/me/srp_e65"


async def test_worker_endpoints_round_trip(client, auth_headers, db_session):
    host, project = await _worker_project(db_session)
    await db_session.commit()

    listed = await client.get(f"/api/execution-hosts/{host.id}/paths", headers=auth_headers)
    assert listed.status_code == 200
    assert listed.json() == [
        {"project_id": project.id, "path": "/home/me/srp_e65", "context_updated_at": None}
    ]

    sent = await client.put(
        f"/api/projects/{project.id}/workspace/context",
        json={"host_id": host.id, "files": [{"path": "README.md", "text": "# E65"}]},
        headers=auth_headers,
    )
    assert sent.status_code == 200
    body = sent.json()
    assert body["context_files"] == ["README.md"]
    assert body["context_updated_at"] is not None
    assert body["paths"][0]["context_files"] == ["README.md"]
