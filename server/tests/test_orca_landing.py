"""Landing an approved Orca run: merge its branch, or open a pull request.

Every test works on real git repositories: a project folder with ``main``
checked out and the run's worktree on its own ``clawchat/...`` branch, as
Orca lays them out.
"""

import asyncio
import json
import os
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from domain.review import ReviewStatus
from exceptions import ConflictError
from execution.orca_cli import OrcaError
from main import app
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, orca_execution_service, orca_landing_service

BRANCH = "clawchat/fix-add-abc123"
BROKEN = "def add(a, b):\n    return a - b\n"
FIXED = "def add(a, b):\n    return a + b\n"


def git(cwd: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(cwd), "-c", "user.name=t", "-c", "user.email=t@e.invalid", *args],
        capture_output=True,
        text=True,
        check=check,
    )
    return result.stdout.strip()


def sha(repo: Path, ref: str) -> str:
    return git(repo, "rev-parse", ref)


def _layout(tmp_path: Path) -> tuple[Path, Path]:
    """The project folder on ``main`` and the run's worktree on ``BRANCH``."""
    repo = tmp_path / "project"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    (repo / "calc.py").write_text(BROKEN)
    (repo / "notes.md").write_text("notes\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "init")
    worktree = tmp_path / "wt"
    git(repo, "worktree", "add", "-q", "-b", BRANCH, str(worktree), "main")
    return repo, worktree


class Remover:
    """Orca's ``worktree rm --delete-branch``, done with git so it can be checked."""

    def __init__(self, repo: Path):
        self.repo = repo
        self.remove_worktree = AsyncMock(side_effect=self._remove)

    async def _remove(self, path, *, delete_branch):
        git(self.repo, "worktree", "remove", "--force", path)
        if delete_branch:
            git(self.repo, "branch", "-D", BRANCH)


async def _approved_run(db_session, repo: Path, worktree: Path, *, agent_commits: bool = False) -> str:
    """An Orca worktree run whose fix was approved, so it sits committed on BRANCH."""
    project = Project(
        id="project_land",
        title="Land",
        default_execution_provider="orca",
        execution_workspace_path=str(repo),
        execution_workspace_isolation="worktree",
        execution_base_branch="main",
    )
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_land", project_id=project.id, title="Fix add")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_land",
        task_type="delegate_general",
        instruction="Fix add() in calc.py",
        todo_id=todo.id,
        agent_type="general",
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(db_session, task, provider="orca", model=None)
    run.status = "waiting_review"
    run.workspace_id = str(worktree)
    run.result = "Fixed add(); tests pass.\n\nChanged files:\n- calc.py (+1 -1)"
    run.usage_json = json.dumps(
        {
            "cwd": str(worktree),
            "worktree_id": "repo-1::wt",
            "branch": f"refs/heads/{BRANCH}",
            "repo_path": str(repo),
            "base_branch": "main",
            # Recorded when the run finished, as for every run that reaches review.
            "files": [{"file": "calc.py", "status": "modified", "additions": 1, "deletions": 1}],
            "patch": "--- a/calc.py\n+++ b/calc.py\n",
        }
    )
    await db_session.commit()
    run_id = run.id
    (worktree / "calc.py").write_text(FIXED)
    if agent_commits:
        git(worktree, "commit", "-qam", "fix add")
    await agent_run_service.decide_run(db_session, run_id, ReviewStatus.APPROVED)
    await db_session.commit()
    return run_id


async def _run(db_session, run_id: str) -> AgentRun:
    db_session.expire_all()
    return await db_session.get(AgentRun, run_id)


async def _events(db_session, run_id: str) -> list[AgentRunEvent]:
    return list(
        (
            await db_session.execute(
                select(AgentRunEvent).where(AgentRunEvent.run_id == run_id).order_by(AgentRunEvent.sequence)
            )
        ).scalars()
    )


async def _event(db_session, run_id: str, event_type: str) -> AgentRunEvent:
    return next(e for e in await _events(db_session, run_id) if e.event_type == event_type)


# -- merge ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_approved_run_is_ready_to_land(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)

    landing = orca_landing_service.landing_view(await _run(db_session, run_id))

    assert landing is not None
    assert (landing.state, landing.branch, landing.base_branch) == ("ready", BRANCH, "main")
    assert landing.can_open_pr is False  # no GitHub remote


@pytest.mark.asyncio
async def test_merge_fast_forwards_when_the_base_has_not_moved(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    approved = sha(repo, BRANCH)

    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))

    assert sha(repo, "main") == approved
    # main is checked out in the project folder, and the folder followed it.
    assert (repo / "calc.py").read_text() == FIXED
    assert git(repo, "status", "--porcelain") == ""
    event = await _event(db_session, run_id, "branch_merged")
    assert "fast-forward" in event.message and approved[:7] in event.message
    landing = orca_landing_service.landing_view(await _run(db_session, run_id))
    assert (landing.state, landing.commit) == ("merged", approved)


@pytest.mark.asyncio
async def test_merge_makes_a_merge_commit_when_the_base_moved(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    (repo / "notes.md").write_text("notes, edited on main\n")
    git(repo, "commit", "-qam", "edit notes on main")
    base_before, approved = sha(repo, "main"), sha(repo, BRANCH)

    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))

    parents = git(repo, "log", "-1", "--format=%P", "main").split()
    assert parents == [base_before, approved]
    assert git(repo, "log", "-1", "--format=%s", "main") == f"Merge branch '{BRANCH}' into main"
    assert (repo / "calc.py").read_text() == FIXED
    assert (repo / "notes.md").read_text() == "notes, edited on main\n"
    assert git(repo, "status", "--porcelain") == ""
    assert "merge commit" in (await _event(db_session, run_id, "branch_merged")).message


@pytest.mark.asyncio
async def test_a_conflict_refuses_the_merge_and_leaves_the_repo_untouched(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    (repo / "calc.py").write_text("def add(a, b):\n    return sum((a, b))\n")
    git(repo, "commit", "-qam", "a different fix on main")
    base_before, branch_before = sha(repo, "main"), sha(repo, BRANCH)
    remover = Remover(repo)

    with pytest.raises(ConflictError) as refused:
        await orca_landing_service.land_run(db_session, run_id, "merge", adapter=remover)

    assert "calc.py" in refused.value.message
    assert refused.value.details == {"conflicts": ["calc.py"]}
    assert (sha(repo, "main"), sha(repo, BRANCH)) == (base_before, branch_before)
    assert git(repo, "status", "--porcelain") == ""
    assert git(worktree, "status", "--porcelain") == ""
    assert worktree.is_dir()
    remover.remove_worktree.assert_not_awaited()
    event = await _event(db_session, run_id, "merge_conflict")
    assert json.loads(event.payload_json)["conflicts"] == ["calc.py"]
    landing = orca_landing_service.landing_view(await _run(db_session, run_id))
    assert (landing.state, landing.conflicts) == ("conflict", ["calc.py"])


@pytest.mark.asyncio
async def test_merge_removes_the_worktree_and_its_branch(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    remover = Remover(repo)

    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=remover)

    remover.remove_worktree.assert_awaited_once_with(str(worktree), delete_branch=True)
    assert not worktree.exists()
    assert git(repo, "branch", "--list", BRANCH) == ""
    assert "workspace_removed" in {e.event_type for e in await _events(db_session, run_id)}


@pytest.mark.asyncio
async def test_a_merge_stands_when_orca_cannot_clean_up(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    approved = sha(repo, BRANCH)
    down = Remover(repo)
    down.remove_worktree = AsyncMock(side_effect=OrcaError("ORCA_NOT_RUNNING", "Orca is not running"))

    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=down)

    assert sha(repo, "main") == approved
    failed = await _event(db_session, run_id, "workspace_cleanup_failed")
    assert "Orca is not running" in failed.message
    assert orca_landing_service.landing_view(await _run(db_session, run_id)).state == "merged"

    # The next Orca run sweeps it, and says why the worktree went.
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    assert await orca_execution_service.sweep_pending_cleanups(factory, adapter=Remover(repo)) == 1
    assert not worktree.exists()
    removed = await _event(db_session, run_id, "workspace_removed")
    assert "merged" in removed.message


@pytest.mark.asyncio
async def test_merge_into_a_base_nobody_has_checked_out_moves_only_the_ref(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    git(repo, "switch", "-q", "-c", "elsewhere")
    approved = sha(repo, BRANCH)

    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))

    assert sha(repo, "main") == approved
    assert git(repo, "symbolic-ref", "--short", "HEAD") == "elsewhere"
    assert (repo / "calc.py").read_text() == BROKEN
    assert git(repo, "status", "--porcelain") == ""


@pytest.mark.asyncio
async def test_merge_never_overwrites_uncommitted_edits_in_the_project_folder(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    (repo / "calc.py").write_text("# my own edit, not committed\n")
    base_before = sha(repo, "main")

    with pytest.raises(ConflictError):
        await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))

    assert sha(repo, "main") == base_before
    assert (repo / "calc.py").read_text() == "# my own edit, not committed\n"
    assert worktree.is_dir()
    assert "merge_failed" in {e.event_type for e in await _events(db_session, run_id)}


@pytest.mark.asyncio
async def test_commits_the_agent_made_itself_can_be_landed(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree, agent_commits=True)
    agent_commit = sha(repo, BRANCH)

    landing = orca_landing_service.landing_view(await _run(db_session, run_id))
    assert landing is not None and landing.state == "ready"
    assert "agent's commits" in (await _event(db_session, run_id, "changes_committed")).message

    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))
    assert sha(repo, "main") == agent_commit


@pytest.mark.asyncio
async def test_two_clicks_at_once_merge_once(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    remover = Remover(repo)

    async def click():
        async with factory() as db:
            return await orca_landing_service.land_run(db, run_id, "merge", adapter=remover)

    outcomes = await asyncio.gather(click(), click(), return_exceptions=True)

    refused = [outcome for outcome in outcomes if isinstance(outcome, Exception)]
    assert len(refused) == 1 and "already merged" in str(refused[0].message)
    remover.remove_worktree.assert_awaited_once()
    assert orca_landing_service.landing_view(await _run(db_session, run_id)).state == "merged"


@pytest.mark.asyncio
async def test_a_merged_run_cannot_be_landed_again(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))

    with pytest.raises(ConflictError, match="already merged"):
        await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))


@pytest.mark.asyncio
async def test_a_run_in_the_project_folder_has_nothing_to_land(db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    run = await _run(db_session, run_id)
    metadata = json.loads(run.usage_json)
    metadata["worktree_id"] = None
    run.usage_json = json.dumps(metadata)
    await db_session.commit()

    assert orca_landing_service.landing_view(run) is None
    with pytest.raises(ConflictError, match="Only an approved Orca run"):
        await orca_landing_service.land_run(db_session, run_id, "merge", adapter=Remover(repo))


# -- pull request ----------------------------------------------------------------


def _github_remote(tmp_path: Path, repo: Path) -> Path:
    """origin points at GitHub, but pushes land in a local bare repository."""
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
    git(repo, "remote", "add", "origin", "https://github.com/acme/widgets.git")
    git(repo, "config", "remote.origin.pushurl", str(bare))
    return bare


def _fake_gh(tmp_path: Path, monkeypatch, *, fail: bool = False) -> Path:
    """A ``gh`` on PATH that records its arguments and the PR body."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    record = tmp_path / "gh-call"
    script = bin_dir / "gh"
    if fail:
        script.write_text("#!/bin/sh\necho 'HTTP 401: Bad credentials' >&2\nexit 1\n")
    else:
        script.write_text(
            "#!/bin/sh\n"
            f"printf '%s\\n' \"$@\" > '{record}.args'\n"
            f"cat > '{record}.body'\n"
            "echo 'https://github.com/acme/widgets/pull/7'\n"
        )
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")
    return record


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/acme/widgets.git", "acme/widgets"),
        ("https://github.com/acme/widgets", "acme/widgets"),
        ("git@github.com:acme/widgets.git", "acme/widgets"),
        ("ssh://git@github.com/acme/widgets.git", "acme/widgets"),
        ("https://token@github.com/acme/widgets.git", "acme/widgets"),
        ("https://gitlab.com/acme/widgets.git", None),
        ("/srv/git/widgets.git", None),
    ],
)
def test_github_remotes_are_recognised(url, expected):
    assert orca_landing_service.github_repo_from_url(url) == expected


@pytest.mark.asyncio
async def test_open_pr_pushes_the_branch_and_opens_it_with_gh(db_session, tmp_path, monkeypatch):
    repo, worktree = _layout(tmp_path)
    bare = _github_remote(tmp_path, repo)
    record = _fake_gh(tmp_path, monkeypatch)
    run_id = await _approved_run(db_session, repo, worktree)
    assert orca_landing_service.landing_view(await _run(db_session, run_id)).can_open_pr is True
    approved, base_before = sha(repo, BRANCH), sha(repo, "main")
    remover = Remover(repo)

    await orca_landing_service.land_run(db_session, run_id, "pull_request", adapter=remover)

    assert git(bare, "rev-parse", f"refs/heads/{BRANCH}") == approved
    args = record.with_suffix(".args").read_text().splitlines()
    assert args[:2] == ["pr", "create"]
    for flag, value in (("--repo", "acme/widgets"), ("--base", "main"), ("--head", BRANCH), ("--title", "Fix add")):
        assert args[args.index(flag) + 1] == value
    body = record.with_suffix(".body").read_text()
    assert "Fixed add(); tests pass." in body and run_id in body
    # A PR changes nothing locally: main stays, the worktree stays for the PR.
    assert sha(repo, "main") == base_before
    assert worktree.is_dir()
    remover.remove_worktree.assert_not_awaited()
    event = await _event(db_session, run_id, "pr_opened")
    assert "https://github.com/acme/widgets/pull/7" in event.message
    landing = orca_landing_service.landing_view(await _run(db_session, run_id))
    assert (landing.state, landing.pr_url) == ("pr_opened", "https://github.com/acme/widgets/pull/7")


@pytest.mark.asyncio
async def test_a_pr_gh_refuses_is_recorded_on_the_run(db_session, tmp_path, monkeypatch):
    repo, worktree = _layout(tmp_path)
    _github_remote(tmp_path, repo)
    _fake_gh(tmp_path, monkeypatch, fail=True)
    run_id = await _approved_run(db_session, repo, worktree)

    with pytest.raises(ConflictError, match="Bad credentials"):
        await orca_landing_service.land_run(db_session, run_id, "pull_request", adapter=Remover(repo))

    assert "Bad credentials" in (await _event(db_session, run_id, "pr_failed")).message
    landing = orca_landing_service.landing_view(await _run(db_session, run_id))
    assert landing.state == "failed" and "Bad credentials" in landing.message


@pytest.mark.asyncio
async def test_open_pr_needs_a_github_remote(db_session, tmp_path, monkeypatch):
    repo, worktree = _layout(tmp_path)
    _fake_gh(tmp_path, monkeypatch)
    run_id = await _approved_run(db_session, repo, worktree)

    with pytest.raises(ConflictError, match="no GitHub remote"):
        await orca_landing_service.land_run(db_session, run_id, "pull_request", adapter=Remover(repo))


# -- the endpoint ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_land_endpoint_merges_and_reports_a_conflict(client, auth_headers, db_session, tmp_path):
    repo, worktree = _layout(tmp_path)
    run_id = await _approved_run(db_session, repo, worktree)
    listed = await client.get("/api/runs", headers=auth_headers)
    assert next(r for r in listed.json() if r["id"] == run_id)["landing"]["state"] == "ready"
    (repo / "calc.py").write_text("def add(a, b):\n    return sum((a, b))\n")
    git(repo, "commit", "-qam", "a different fix on main")
    previous = getattr(app.state, "orca_adapter", None)
    app.state.orca_adapter = Remover(repo)
    try:
        refused = await client.post(f"/api/runs/{run_id}/land", headers=auth_headers, json={"method": "merge"})
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"]["details"] == {"conflicts": ["calc.py"]}

        git(repo, "reset", "-q", "--hard", "HEAD~1")
        merged = await client.post(f"/api/runs/{run_id}/land", headers=auth_headers, json={"method": "merge"})
    finally:
        if previous is None:
            del app.state.orca_adapter
        else:
            app.state.orca_adapter = previous
    assert merged.status_code == 200, merged.text
    landing = merged.json()["landing"]
    assert (landing["state"], landing["base_branch"], landing["conflicts"]) == ("merged", "main", [])
    events = await client.get(f"/api/runs/{run_id}/events", headers=auth_headers)
    types = [event["event_type"] for event in events.json()]
    assert types.index("merge_conflict") < types.index("branch_merged") < types.index("workspace_removed")
