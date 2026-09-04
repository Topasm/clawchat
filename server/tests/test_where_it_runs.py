"""Every run and project says which machine it runs on."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from models.agent_task import AgentTask
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, execution_host_service
from services.tasks import project_service


@pytest.fixture
def pushed(monkeypatch):
    fake = SimpleNamespace(send_json=AsyncMock())
    monkeypatch.setattr(agent_run_service, "ws_manager", fake)
    return fake


async def make_task(db_session):
    project = Project(id="project_where", title="Where project")
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_where", project_id=project.id, title="Run the sweep")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_where",
        task_type="research",
        instruction="Run the sweep",
        todo_id=todo.id,
        agent_type="research",
    )
    db_session.add(task)
    await db_session.flush()
    project.root_task_id = todo.id
    await db_session.commit()
    return project, task


@pytest.mark.asyncio
async def test_worker_run_names_its_machine_everywhere(db_session, pushed):
    _project, task = await make_task(db_session)
    host = await execution_host_service.register_worker(
        db_session, label="ubuntu-lab", platform="linux"
    )
    run = await agent_run_service.create_run(db_session, task, provider="claude_code")
    run.execution_host_id = host.id
    await db_session.commit()

    response = await agent_run_service.build_run_response(db_session, run)
    assert response.host_label == "ubuntu-lab"

    await agent_run_service.mark_starting(db_session, run)
    await db_session.commit()
    event = next(
        call.args[1]["data"]
        for call in pushed.send_json.await_args_list
        if call.args[1]["type"] == "run_state_changed"
    )
    assert event["host_label"] == "ubuntu-lab"


@pytest.mark.asyncio
async def test_server_run_has_no_machine_label(db_session, pushed):
    _project, task = await make_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()

    response = await agent_run_service.build_run_response(db_session, run)
    assert response.host_label is None


@pytest.mark.asyncio
async def test_paseo_run_reports_the_daemon_label(db_session, pushed):
    _project, task = await make_task(db_session)
    run = await agent_run_service.create_run(
        db_session, task, provider="paseo", host_id="paseo@lab"
    )
    await db_session.commit()

    response = await agent_run_service.build_run_response(db_session, run)
    assert response.host_label == "paseo@lab"


@pytest.mark.asyncio
async def test_project_reports_its_execution_host_and_whether_it_is_online(db_session):
    project, _task = await make_task(db_session)
    host = await execution_host_service.register_worker(
        db_session, label="mac", platform="darwin"
    )
    project.execution_host_id = host.id
    await db_session.commit()

    listed = {item.id: item for item in await project_service.list_projects(db_session)}
    assert listed[project.id].execution_host_label == "mac"
    assert listed[project.id].execution_host_online is True

    host.last_seen_at = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.commit()
    listed = {item.id: item for item in await project_service.list_projects(db_session)}
    assert listed[project.id].execution_host_online is False

    project.execution_host_id = None
    await db_session.commit()
    listed = {item.id: item for item in await project_service.list_projects(db_session)}
    assert listed[project.id].execution_host_label is None
    assert listed[project.id].execution_host_online is None
