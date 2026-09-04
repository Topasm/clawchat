"""Resume a run that stopped in ``waiting_input`` with a follow-up instruction.

Two doors lead here: the Runs page's explicit "Resume with follow-up", and a
review decision of *changes requested* whose note is the follow-up. Both must
do exactly the same thing to the run, so the logic lives once, here.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from domain.agent_run import AgentRunStatus
from domain.review import ReviewStatus, ReviewSubjectType
from exceptions import ConflictError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.message import Message
from services.agents import (
    agent_run_service,
    agent_task_service,
    paseo_execution_service,
)
from services.review import review_item_service
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id
from ws.manager import ws_manager


def active_provider(app_state: Any) -> tuple[str, Any, str | None]:
    """Return the provider name, AI service and model the server executes with."""
    provider = getattr(app_state, "active_ai_provider", "openclaw")
    ai = getattr(app_state, "active_ai", None) or getattr(app_state, "ai_service", None)
    if ai is None:
        raise ConflictError("No execution provider is available")
    return provider, ai, getattr(ai, "model", None)


async def resume_with_follow_up(
    db: AsyncSession,
    app_state: Any,
    run: AgentRun,
    task: AgentTask,
    follow_up: str,
    *,
    user_id: str,
) -> AgentRun:
    """Append ``follow_up`` to the run's instruction and start executing again.

    The caller's session is committed here: the background execution opens its
    own session and must see the resumed state. Raises ``ConflictError`` when
    the run is not waiting for input or its provider is no longer the active
    one -- in that case nothing has been changed.
    """
    if run.status != AgentRunStatus.WAITING_INPUT:
        raise ConflictError(f"Agent run cannot be resumed from {run.status}")
    follow_up = follow_up.strip()
    if not follow_up:
        raise ConflictError("A follow-up instruction is required to resume")

    paseo_adapter = None
    provider = None
    ai_service = None
    model = None
    if run.provider == "paseo":
        paseo_adapter = getattr(app_state, "paseo_adapter", None) or (
            paseo_execution_service.adapter_from_settings()
        )
    else:
        provider, ai_service, model = active_provider(app_state)
        if run.provider != provider:
            raise ConflictError(
                f"Run provider {run.provider!r} is unavailable; "
                f"active provider is {provider!r}"
            )

    run.instruction_snapshot = (
        f"{run.instruction_snapshot}\n\nFollow-up instruction:\n{follow_up}"
    )
    run.status = AgentRunStatus.STARTING
    run.progress = 0
    run.progress_message = "Resuming with follow-up instruction"
    run.result = None
    run.result_summary = None
    run.error = None
    run.completed_at = None
    run.heartbeat_at = datetime.now(timezone.utc)
    task.instruction = run.instruction_snapshot
    task.status = "queued"
    task.result = None
    task.error = None
    task.progress = 0
    task.completed_at = None
    if task.conversation_id:
        db.add(
            Message(
                id=make_id("msg_"),
                conversation_id=task.conversation_id,
                role="user",
                content=follow_up,
                message_type="text",
            )
        )
    # This review round is over: the follow-up supersedes it. A fresh review
    # item is published when the resumed run finishes again.
    await review_item_service.set_subject_review_status(
        db,
        ReviewSubjectType.AGENT_RUN,
        run.id,
        ReviewStatus.EXPIRED,
    )
    await agent_run_service.record_event(
        db, run, "resuming", "Resuming with follow-up instruction", progress=0
    )
    # Notify before the commit: the thread message it writes rides on it.
    await agent_run_service.notify_run_state(db, run, task, user_id=user_id)
    await db.commit()

    session_factory = app_state.session_factory
    if run.provider == "paseo":
        agent_run_service.launch_execution(
            run.id,
            paseo_execution_service.resume_external_run(
                session_factory,
                run.id,
                follow_up,
                user_id=user_id,
                adapter=paseo_adapter,
            ),
        )
        return run

    task_id = task.id
    run_id = run.id

    async def execute() -> None:
        async with session_factory() as run_db:
            persisted_task = await run_db.get(AgentTask, task_id)
            persisted_run = await run_db.get(AgentRun, run_id)
            if persisted_task is None or persisted_run is None:
                return
            await agent_task_service.execute_task(
                run_db,
                persisted_task,
                ai_service,
                ws_manager,
                user_id,
                session_factory=session_factory,
                run=persisted_run,
                provider=provider,
                model=model,
            )

    agent_run_service.launch_execution(run.id, execute())
    return run
