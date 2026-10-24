"""A project's autonomy policy: ready tasks start without a click.

Until now the only work that started by itself was a scheduled job. An ad-hoc
task waited for a person to pick a skill chain and press Start, however many
of its siblings had just become ready. A project that is not ``manual`` now
does that part itself: whenever something makes tasks ready -- an approved
result, an applied plan, the policy being switched on -- every ready leaf of
the project that has no active run is handed to the ordinary delegation path
(``delegate_todo_to_skill`` with ``require_ready`` and ``approved``) with the
project's default skill chain. That path's CAS on the task's status is what
makes two triggers never start the same task twice.

What the policy never does:

* run on a machine that is off (``EXECUTION_HOST_UNAVAILABLE`` stays an
  error for a person; the policy skips and says so once in the project thread);
* run the ``plan`` skill, which has its own proposal lifecycle;
* start more than ``PROJECT_AUTONOMY_DAILY_CAP`` runs per project per UTC
  day (past it the policy stops and says so once);
* adopt a result a person has not seen, unless the project is
  ``auto_start_and_accept`` and the run could not have changed anything
  (risk ``low`` or ``read_only_tools``). ``medium`` and ``high`` always wait,
  and the phone's one-tap Approve still covers ``low`` alone.

A run the policy started carries ``provenance: policy`` in its task payload,
the way a scheduled job's carries ``scheduled_job_id``, so review cards and
the run thread can say the project started it.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, time, timezone
from typing import Any, Literal

from domain.agent_run import AGENT_RUN_ACTIVE_STATUSES
from domain.project import ProjectAutonomy
from domain.review import ReviewRiskLevel
from exceptions import AppError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from models.todo import Todo
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id
from ws.notifications import DEFAULT_USER_ID, notify_after_commit

logger = logging.getLogger(__name__)

PROVENANCE = "policy"
#: The review note a result adopted by the project's policy carries.
POLICY_APPROVED_NOTE = (
    "Approved automatically: this project's policy accepts results that "
    "could not have changed anything"
)
#: The risk tiers ``auto_start_and_accept`` adopts; never widen this to
#: ``medium`` -- a result that could have changed files is always asked about.
ACCEPTED_RISK_LEVELS = frozenset({ReviewRiskLevel.LOW, ReviewRiskLevel.READ_ONLY_TOOLS})
#: Delegation errors that mean another trigger (or a person) already started
#: this task, or it stopped being ready: the policy moves on to the next task.
_LOST_RACE_CODES = frozenset(
    {"TASK_NOT_READY", "TASK_EXECUTION_ACTIVE", "TASK_EXECUTION_CONFLICT"}
)
POLICY_MESSAGE_TYPE = "policy_update"

Trigger = Literal["review_approved", "plan_applied", "policy_enabled"]

_app_state: Any | None = None


def configure(app_state: Any | None) -> None:
    """Remember where the process keeps its providers (``app.state``).

    The policy fires from inside services that have no request to read it
    off, so the lifespan hands it over once.
    """
    global _app_state
    _app_state = app_state


def _runtime():
    from services.agents.task_delegation_service import DelegationRuntime
    from services.ai import resolve_active_ai

    state = _app_state
    if state is None:
        return None
    session_factory = getattr(state, "session_factory", None)
    if session_factory is None:
        return None
    return DelegationRuntime(
        session_factory=session_factory,
        active_ai=resolve_active_ai(state),
        active_ai_provider=getattr(state, "active_ai_provider", "openclaw"),
        paseo_adapter=getattr(state, "paseo_adapter", None),
        opencode_adapter=getattr(state, "opencode_adapter", None),
    )


# --- provenance -------------------------------------------------------------


def policy_provenance(task: AgentTask) -> dict[str, Any] | None:
    """The policy start recorded on this task, if the project started it."""
    try:
        payload = json.loads(task.payload_json) if task.payload_json else {}
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("provenance") != PROVENANCE:
        return None
    return payload


def is_policy_started(task: AgentTask) -> bool:
    return policy_provenance(task) is not None


def skill_chain_of(project: Project) -> list[str]:
    try:
        chain = json.loads(project.default_skill_chain) if project.default_skill_chain else []
    except (TypeError, ValueError):
        return []
    return [str(skill) for skill in chain if skill] if isinstance(chain, list) else []


async def accepts_result(db: AsyncSession, task: AgentTask, run: AgentRun) -> bool:
    """Whether this run's project adopts results the run could not have used
    to change anything, and the policy started the run in the first place."""
    if not is_policy_started(task) or not run.project_id:
        return False
    project = await db.get(Project, run.project_id)
    return project is not None and project.autonomy == ProjectAutonomy.AUTO_START_AND_ACCEPT


# --- the project thread -----------------------------------------------------


async def _project_thread(db: AsyncSession, project: Project) -> Conversation:
    """The project's own thread (root-scoped, no metadata), created if missing."""
    conversation = (
        await db.execute(
            select(Conversation)
            .where(
                Conversation.project_id == project.id,
                Conversation.project_todo_id == project.root_task_id,
                Conversation.metadata_json.is_(None),
            )
            .order_by(Conversation.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if conversation is None:
        conversation = Conversation(
            id=make_id("conv_"),
            title=project.title[:80],
            project_id=project.id,
            project_todo_id=project.root_task_id,
        )
        db.add(conversation)
        await db.flush()
    return conversation


async def _note(
    db: AsyncSession,
    project: Project,
    *,
    kind: str,
    text: str,
    user_id: str = DEFAULT_USER_ID,
) -> bool:
    """Say ``text`` once per project, kind and day in the project's thread.

    The policy may be asked many times a day; the thread should carry one
    line about the machine being off or the cap being reached, not one per
    trigger.
    """
    key = f"policy:{project.id}:{kind}:{datetime.now(timezone.utc).date().isoformat()}"
    conversation = await _project_thread(db, project)
    exists = (
        await db.execute(
            select(func.count(Message.id)).where(
                Message.conversation_id == conversation.id,
                Message.idempotency_key == key,
            )
        )
    ).scalar_one()
    if exists:
        return False
    db.add(
        Message(
            id=make_id("msg_"),
            conversation_id=conversation.id,
            role="assistant",
            content=text,
            message_type=POLICY_MESSAGE_TYPE,
            idempotency_key=key,
            metadata_json=json.dumps(
                {"action_type": "policy_update", "kind": kind, "project_id": project.id},
                ensure_ascii=False,
            ),
        )
    )
    conversation.updated_at = datetime.now(timezone.utc)
    await db.flush()
    notify_after_commit(
        db,
        {"type": "conversation_updated", "data": {"conversation_id": conversation.id}},
        user_id,
    )
    logger.info("Project %s autonomy policy: %s", project.id, text)
    return True


# --- starting ---------------------------------------------------------------


async def started_today(db: AsyncSession, project_id: str) -> int:
    """How many runs the policy started for this project since UTC midnight."""
    day_start = datetime.combine(datetime.now(timezone.utc).date(), time.min, timezone.utc)
    return (
        await db.execute(
            select(func.count(AgentRun.id))
            .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
            .where(
                AgentRun.project_id == project_id,
                AgentRun.created_at >= day_start,
                AgentTask.payload_json.like(f'%"provenance": "{PROVENANCE}"%'),
            )
        )
    ).scalar_one()


async def _ready_leaves(db: AsyncSession, project: Project) -> list[str]:
    """Ready leaf tasks of the project with no active run, oldest first."""
    from services.tasks import graph_insights_service

    insights = await graph_insights_service.get_graph_insights(
        db, root_task_id=project.root_task_id
    )
    candidate_ids = [
        node.task_id
        for node in insights.nodes
        if node.is_ready and not node.is_container and node.task_id != project.root_task_id
    ]
    if not candidate_ids:
        return []
    rows = (
        await db.execute(
            select(Todo.id)
            .where(Todo.id.in_(candidate_ids), Todo.project_id == project.id)
            .order_by(Todo.sort_order.asc(), Todo.created_at.asc(), Todo.id.asc())
        )
    ).all()
    ordered = [row[0] for row in rows]
    if not ordered:
        return []
    busy = set(
        (
            await db.execute(
                select(AgentTask.todo_id)
                .join(AgentRun, AgentRun.agent_task_id == AgentTask.id)
                .where(
                    AgentTask.todo_id.in_(ordered),
                    AgentRun.status.in_(AGENT_RUN_ACTIVE_STATUSES),
                )
            )
        ).scalars()
    )
    return [todo_id for todo_id in ordered if todo_id not in busy]


async def start_ready_tasks(
    db: AsyncSession,
    project_id: str,
    *,
    trigger: Trigger,
    user_id: str = DEFAULT_USER_ID,
) -> list[str]:
    """Start every ready leaf the project's policy may start; return run ids.

    Safe to call from inside another service's transaction: each start is
    wrapped in a savepoint, so a start that fails leaves the caller's own
    pending writes alone, and a start that succeeds commits them along with
    the run (the delegation path commits). Never raises for the policy's own
    reasons; the caller's work must not fail because the project could not
    start something.
    """
    try:
        return await _start_ready_tasks(db, project_id, trigger=trigger, user_id=user_id)
    except Exception:
        logger.exception("Project %s autonomy policy failed (%s)", project_id, trigger)
        return []


async def _start_ready_tasks(
    db: AsyncSession,
    project_id: str,
    *,
    trigger: Trigger,
    user_id: str,
) -> list[str]:
    from config import settings
    from schemas.task import DelegateRequest
    from services.agents import execution_host_service
    from services.agents.task_delegation_service import delegate_todo_to_skill

    project = await db.get(Project, project_id)
    if project is None or project.autonomy == ProjectAutonomy.MANUAL:
        return []
    chain = skill_chain_of(project)
    if not chain or "plan" in chain:
        # The update path refuses these; an older row may still hold them.
        logger.info("Project %s autonomy policy has no runnable skill chain", project.id)
        return []
    runtime = _runtime()
    if runtime is None:
        logger.warning("Project %s autonomy policy has no execution runtime", project.id)
        return []

    workspace = await execution_host_service.resolve_workspace(db, project)
    if workspace.host is not None and workspace.is_offline:
        if await _note(
            db,
            project,
            kind="host_offline",
            text=(
                f"The project's policy did not start anything: {workspace.host.label} "
                "is off. Open ClawChat there, or move this project to a machine that is running."
            ),
            user_id=user_id,
        ):
            await db.commit()
        return []

    cap = max(0, int(settings.project_autonomy_daily_cap))
    used = await started_today(db, project.id)
    ready = await _ready_leaves(db, project)
    started: list[str] = []
    noted = False
    for todo_id in ready:
        if used + len(started) >= cap:
            noted |= await _note(
                db,
                project,
                kind="daily_cap",
                text=(
                    f"The project's policy started {cap} runs today, its daily limit, "
                    "and is waiting until tomorrow. Start the rest yourself if they "
                    "cannot wait."
                ),
                user_id=user_id,
            )
            break
        nested = await db.begin_nested()
        try:
            result = await delegate_todo_to_skill(
                db,
                todo_id,
                DelegateRequest(
                    require_ready=True,
                    approved=True,
                    execution_provider=project.default_execution_provider,
                    model=project.default_execution_model,
                ),
                runtime,
                user_id,
                skill_chain=chain,
                payload={
                    "provenance": PROVENANCE,
                    "project_id": project.id,
                    "trigger": trigger,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except AppError as exc:
            if nested.is_active:
                await nested.rollback()
            if exc.code in _LOST_RACE_CODES:
                # Someone else started it, or it is no longer ready.
                continue
            noted |= await _note(
                db,
                project,
                kind=f"start_failed:{exc.code}",
                text=f"The project's policy could not start a task: {exc.message}",
                user_id=user_id,
            )
            break
        except Exception:
            if nested.is_active:
                await nested.rollback()
            logger.exception("Project %s autonomy policy failed to start %s", project.id, todo_id)
            break
        started.append(result["run_id"])
        logger.info(
            "Project %s autonomy policy started run %s for %s (%s)",
            project.id,
            result["run_id"],
            todo_id,
            trigger,
        )
    if started or noted:
        await db.commit()
    return started


__all__ = [
    "ACCEPTED_RISK_LEVELS",
    "POLICY_APPROVED_NOTE",
    "POLICY_MESSAGE_TYPE",
    "PROVENANCE",
    "accepts_result",
    "configure",
    "is_policy_started",
    "policy_provenance",
    "skill_chain_of",
    "start_ready_tasks",
    "started_today",
]
