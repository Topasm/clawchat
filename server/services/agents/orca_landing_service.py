"""Land an approved Orca run: merge its branch into the base, or open a PR.

Approval commits a worktree run's changes on its ``clawchat/<task>-<id>``
branch (``orca_execution_service.settle_workspace``). This module takes the
last step from inside ClawChat.

Merge never touches a working tree until the merge is known to be clean.
The result is computed with ``git merge-tree``: a fast-forward when the base
has not moved, otherwise a merge commit built with ``commit-tree``. A
conflict refuses the merge and names the files, and both branches stay
exactly as they were. The base branch then moves to the result: through
``git merge --ff-only`` where it is checked out (so that checkout follows,
and git itself refuses to overwrite local edits), or with a compare-and-swap
``update-ref`` where it is not. After a merge the run's worktree and branch
are removed. Merging never pushes.

A pull request pushes only the run's branch to the project's GitHub remote
and opens the PR with ``gh``; the worktree and branch stay for the PR.

Each outcome is a run event and is kept on the run's metadata under
``landing``, which the run card reads through ``AgentRunResponse.landing``.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from datetime import datetime, timezone
from typing import Any, Literal

from domain.agent_run import AgentRunStatus
from exceptions import ConflictError
from execution.orca_cli import OrcaAdapter
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.todo import Todo
from schemas.agent_run import RunLanding
from services.agents import agent_run_service, execution_host_service
from services.agents.orca_execution_service import (
    PROVIDER,
    _metadata,
    _save_metadata,
    discard_workspace,
)
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed

LandMethod = Literal["merge", "pull_request"]

GH_COMMAND = "gh"
#: GitHub refuses a PR body past 65,536 characters.
MAX_PR_BODY_CHARS = 60_000
_GITHUB_URL = re.compile(
    r"^(?:https?://(?:[^@/]+@)?github\.com/|(?:ssh://)?git@github\.com[:/])"
    r"(?P<repo>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)
#: Never let git or gh stop to ask for a password on a server with no terminal.
_NON_INTERACTIVE = {"GIT_TERMINAL_PROMPT": "0", "GH_PROMPT_DISABLED": "1"}
#: One landing per run at a time: a second click waits, then sees the first's outcome.
_run_locks: dict[str, asyncio.Lock] = {}


class _Refused(Exception):
    """A landing that did not happen, and the run event that records it.

    ``event`` defaults to ``merge_failed`` or ``pr_failed`` by method.
    """

    def __init__(
        self,
        message: str,
        *,
        event: str | None = None,
        state: str = "failed",
        payload: dict | None = None,
    ):
        super().__init__(message)
        self.event = event
        self.message = message
        self.state = state
        self.payload = payload or {}


async def _run(
    *args: str, cwd: str | None = None, stdin: str | None = None
) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        cwd=cwd,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, **_NON_INTERACTIVE},
    )
    stdout, stderr = await process.communicate(stdin.encode("utf-8") if stdin is not None else None)
    return (
        process.returncode or 0,
        stdout.decode("utf-8", errors="replace").strip(),
        stderr.decode("utf-8", errors="replace").strip(),
    )


async def _git(cwd: str, *args: str, stdin: str | None = None) -> tuple[int, str, str]:
    return await _run("git", "-C", cwd, *args, stdin=stdin)


async def _git_ok(cwd: str, *args: str) -> str:
    code, out, err = await _git(cwd, *args)
    if code != 0:
        raise _Refused(err or out or f"git {args[0]} exited with {code}")
    return out


async def _sha(repo: str, ref: str) -> str | None:
    code, out, _ = await _git(repo, "rev-parse", "--verify", "-q", f"{ref}^{{commit}}")
    return out if code == 0 and out else None


def _local_branch(name: str | None) -> str | None:
    return (name or "").strip().removeprefix("refs/heads/") or None


def github_repo_from_url(url: str) -> str | None:
    """``owner/name`` for a github.com remote URL, else None."""
    match = _GITHUB_URL.match(url.strip())
    return match.group("repo") if match else None


async def github_remote(repo: str) -> tuple[str, str] | None:
    """The project's GitHub remote as ``(remote, owner/name)``; origin first."""
    code, out, _ = await _git(repo, "remote")
    if code != 0:
        return None
    remotes = out.split()
    for remote in sorted(remotes, key=lambda name: name != "origin"):
        code, url, _ = await _git(repo, "config", "--get", f"remote.{remote}.url")
        name = github_repo_from_url(url) if code == 0 else None
        if name:
            return remote, name
    return None


async def remember_landing_target(run: AgentRun) -> None:
    """Note where an approved run can land, so listing runs needs no git call."""
    metadata = _metadata(run)
    repo = metadata.get("repo_path")
    if not repo or not os.path.isdir(repo):
        return
    remote = await github_remote(repo)
    if remote:
        metadata["github_remote"] = {"name": remote[0], "repo": remote[1]}
        _save_metadata(run, metadata)


def landing_view(run: AgentRun) -> RunLanding | None:
    """What the run card shows about landing an approved Orca worktree run."""
    if run.provider != PROVIDER or not run.is_adopted or run.status != AgentRunStatus.COMPLETED:
        return None
    metadata = _metadata(run)
    branch = _local_branch(metadata.get("branch"))
    if not metadata.get("worktree_id") or not metadata.get("commit") or not branch:
        return None
    landing = metadata.get("landing") if isinstance(metadata.get("landing"), dict) else {}
    github = metadata.get("github_remote") if isinstance(metadata.get("github_remote"), dict) else {}
    return RunLanding(
        state=landing.get("state") or "ready",
        branch=branch,
        base_branch=landing.get("base_branch") or _local_branch(metadata.get("base_branch")),
        can_open_pr=bool(github.get("repo")) and shutil.which(GH_COMMAND) is not None,
        commit=landing.get("commit"),
        pr_url=landing.get("pr_url"),
        conflicts=[str(path) for path in landing.get("conflicts") or []],
        message=landing.get("message"),
    )


async def _repo_path(db: AsyncSession, run: AgentRun, metadata: dict[str, Any]) -> str:
    repo = metadata.get("repo_path")
    if not repo and run.project_id:
        project = await db.get(Project, run.project_id)
        workspace = await execution_host_service.resolve_workspace(db, project) if project else None
        repo = os.path.expanduser(workspace.path) if workspace and workspace.path else None
    if not repo or not os.path.isdir(repo):
        raise _Refused("The project folder this run came from is not on this machine")
    return repo


async def _base_branch(
    db: AsyncSession, run: AgentRun, repo: str, metadata: dict[str, Any]
) -> str:
    """The local branch the run lands in: the one it was cut from."""
    wanted = _local_branch(metadata.get("base_branch"))
    if not wanted and run.project_id:
        project = await db.get(Project, run.project_id)
        wanted = _local_branch(project.execution_base_branch if project else None)
    if not wanted:
        code, out, _ = await _git(repo, "symbolic-ref", "--short", "-q", "HEAD")
        wanted = out if code == 0 and out else None
    if not wanted:
        raise _Refused("This run does not say which branch it should land in")
    if await _sha(repo, f"refs/heads/{wanted}"):
        return wanted
    # "origin/main" names the remote's copy; the merge goes into local main.
    code, out, _ = await _git(repo, "remote")
    for remote in out.split() if code == 0 else []:
        if wanted.startswith(f"{remote}/"):
            local = wanted.removeprefix(f"{remote}/")
            if await _sha(repo, f"refs/heads/{local}"):
                return local
    raise _Refused(f"The branch {wanted} does not exist in {repo}")


async def _checked_out_at(repo: str, branch: str) -> str | None:
    """The working tree that has ``branch`` checked out, if any."""
    out = await _git_ok(repo, "worktree", "list", "--porcelain")
    path = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line.removeprefix("worktree ")
        elif line == f"branch refs/heads/{branch}":
            return path
    return None


async def _identity(repo: str) -> list[str]:
    code, _, _ = await _git(repo, "var", "GIT_COMMITTER_IDENT")
    return [] if code == 0 else ["-c", "user.name=ClawChat", "-c", "user.email=clawchat@localhost"]


async def _merge(
    repo: str, *, branch: str, base: str, title: str, run_id: str
) -> tuple[str, str]:
    """Move ``base`` to include ``branch``; ``(new base commit, how)``."""
    branch_sha = await _sha(repo, f"refs/heads/{branch}")
    if branch_sha is None:
        raise _Refused(f"The run's branch {branch} no longer exists")
    base_sha = await _sha(repo, f"refs/heads/{base}")
    if base_sha is None:
        raise _Refused(f"The branch {base} does not exist in {repo}")

    is_merged, _, _ = await _git(repo, "merge-base", "--is-ancestor", branch_sha, base_sha)
    if is_merged == 0:
        return base_sha, "nothing new"
    can_ff, _, _ = await _git(repo, "merge-base", "--is-ancestor", base_sha, branch_sha)
    if can_ff == 0:
        target, how = branch_sha, "fast-forward"
    else:
        code, out, err = await _git(
            repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", base_sha, branch_sha
        )
        lines = out.splitlines()
        if code == 1 and lines:
            conflicts = list(dict.fromkeys(line for line in lines[1:] if line.strip()))
            shown = ", ".join(conflicts[:10]) + (f" and {len(conflicts) - 10} more" if len(conflicts) > 10 else "")
            raise _Refused(
                f"Merging {branch} into {base} would conflict in {shown or 'some files'}. Nothing was changed.",
                event="merge_conflict",
                state="conflict",
                payload={"conflicts": conflicts},
            )
        if code != 0 or not lines:
            if "write-tree" in err or "usage:" in err:
                raise _Refused("Merging needs git 2.38 or newer on this machine")
            raise _Refused(err or out or "git merge-tree failed")
        message = f"Merge branch '{branch}' into {base}\n\n{title}\n\nApproved in ClawChat (run {run_id})"
        target = await _git_ok(
            repo,
            *await _identity(repo),
            "commit-tree",
            lines[0],
            "-p",
            base_sha,
            "-p",
            branch_sha,
            "-m",
            message,
        )
        how = "merge commit"

    checkout = await _checked_out_at(repo, base)
    if checkout:
        # The checkout follows the branch. git refuses, and moves nothing,
        # when that would overwrite the person's uncommitted edits, or when
        # the base moved since it was read (``target`` no longer descends).
        code, out, err = await _git(checkout, "merge", "--ff-only", "--quiet", target)
        if code != 0:
            raise _Refused(
                f"{base} is checked out at {checkout} and could not be updated: {err or out}"[:500]
            )
    else:
        code, out, err = await _git(
            repo, "update-ref", "-m", f"clawchat: land run {run_id}", f"refs/heads/{base}", target, base_sha
        )
        if code != 0:
            raise _Refused(f"{base} moved while merging; try again ({err or out})"[:500])
    return target, how


async def _open_pull_request(
    repo: str, *, branch: str, base: str, title: str, body: str
) -> str:
    gh = shutil.which(GH_COMMAND)
    if gh is None:
        raise _Refused("The GitHub CLI (gh) is not installed on this machine")
    remote = await github_remote(repo)
    if remote is None:
        raise _Refused("This project has no GitHub remote")
    remote_name, slug = remote
    code, out, err = await _git(
        repo, "push", "--quiet", "--set-upstream", remote_name, f"refs/heads/{branch}:refs/heads/{branch}"
    )
    if code != 0:
        raise _Refused(f"Could not push {branch} to {remote_name}: {err or out}"[:500])
    code, out, err = await _run(
        gh,
        "pr",
        "create",
        "--repo",
        slug,
        "--base",
        base,
        "--head",
        branch,
        "--title",
        title,
        "--body-file",
        "-",
        cwd=repo,
        stdin=body,
    )
    if code != 0:
        raise _Refused(f"gh could not open the pull request: {err or out}"[:500])
    url = next((line for line in reversed(out.splitlines()) if line.startswith("http")), "")
    if not url:
        raise _Refused(f"gh did not return the pull request's address: {out}"[:500])
    return url


def _pr_body(run: AgentRun) -> str:
    summary = (run.result or run.result_summary or "").strip()
    if len(summary) > MAX_PR_BODY_CHARS:
        summary = summary[:MAX_PR_BODY_CHARS] + "\n\n…(summary truncated)"
    footer = f"Approved in ClawChat (run {run.id})."
    return f"{summary}\n\n---\n{footer}" if summary else footer


def _record_landing(run: AgentRun, **values: Any) -> None:
    metadata = _metadata(run)
    landing = metadata.get("landing") if isinstance(metadata.get("landing"), dict) else {}
    landing.update(values, at=datetime.now(timezone.utc).isoformat())
    metadata["landing"] = {key: value for key, value in landing.items() if value is not None}
    _save_metadata(run, metadata)


async def land_run(
    db: AsyncSession,
    run_id: str,
    method: LandMethod,
    *,
    adapter: OrcaAdapter | None = None,
) -> AgentRun:
    """Merge or open a PR for an approved run; every outcome becomes an event.

    A refusal is committed with its event before it is raised, so the run
    card shows it (the files a merge would conflict in, or gh's error).
    """
    lock = _run_locks.setdefault(run_id, asyncio.Lock())
    try:
        async with lock:
            return await _land(db, run_id, method, adapter=adapter)
    finally:
        if not lock.locked():
            _run_locks.pop(run_id, None)


async def _land(
    db: AsyncSession,
    run_id: str,
    method: LandMethod,
    *,
    adapter: OrcaAdapter | None,
) -> AgentRun:
    run = await agent_run_service.require_run_for_update(db, run_id)
    await db.refresh(run)
    view = landing_view(run)
    if view is None:
        raise ConflictError("Only an approved Orca run with committed changes can be landed")
    if view.state == "merged":
        raise ConflictError(f"This run was already merged into {view.base_branch}")
    if view.state == "pr_opened" and method == "pull_request":
        return run
    task = await db.get(AgentTask, run.agent_task_id)
    todo = await db.get(Todo, task.todo_id) if task and task.todo_id else None
    title = todo.title if todo else (task.task_type if task else run.id)
    metadata = _metadata(run)
    branch = view.branch
    base = view.base_branch
    try:
        repo = await _repo_path(db, run, metadata)
        base = await _base_branch(db, run, repo, metadata)
        if method == "merge":
            commit, how = await _merge(repo, branch=branch, base=base, title=title, run_id=run.id)
        else:
            url = await _open_pull_request(
                repo, branch=branch, base=base, title=title, body=_pr_body(run)
            )
    except _Refused as refused:
        _record_landing(
            run,
            state=refused.state,
            base_branch=base,
            conflicts=refused.payload.get("conflicts") or [],
            message=refused.message,
        )
        await agent_run_service.record_event(
            db,
            run,
            refused.event or ("merge_failed" if method == "merge" else "pr_failed"),
            refused.message[:500],
            payload={"branch": branch, "base_branch": base, "method": method, **refused.payload},
        )
        await db.commit()
        await notify_module_data_changed("runs")
        raise ConflictError(refused.message, details=refused.payload or None) from None

    if method == "pull_request":
        _record_landing(run, state="pr_opened", base_branch=base, pr_url=url, conflicts=[], message=None)
        await agent_run_service.record_event(
            db,
            run,
            "pr_opened",
            f"Opened a pull request from {branch} into {base}: {url}",
            payload={"branch": branch, "base_branch": base, "url": url},
        )
        await db.commit()
        await notify_module_data_changed("runs")
        return run

    _record_landing(run, state="merged", base_branch=base, commit=commit, conflicts=[], message=None)
    await agent_run_service.record_event(
        db,
        run,
        "branch_merged",
        f"Merged {branch} into {base} ({how}, {commit[:7]})",
        payload={"branch": branch, "base_branch": base, "commit": commit, "how": how},
    )
    # The merge stands on its own; removing the worktree after it is best
    # effort, and one Orca cannot remove now is retried by the next Orca run.
    await db.commit()
    await discard_workspace(db, run=run, adapter=adapter, reason="merged")
    await db.commit()
    await notify_module_data_changed("runs")
    return run
