"""Agent execution attempt inspection and control endpoints."""

from datetime import datetime, timezone

from auth.dependencies import get_current_user
from database import get_db
from domain.agent_run import AgentRunStatus
from exceptions import ConflictError, NotFoundError
from fastapi import APIRouter, Depends, Query, Request
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from schemas.agent_run import (
    AgentRunDetailResponse,
    AgentRunEventResponse,
    AgentRunHeartbeatRequest,
    AgentRunRecoveryResponse,
    AgentRunResponse,
    AgentRunResultRequest,
    AgentRunResumeRequest,
    AgentRunRetryRequest,
    AgentRunTransitionRequest,
)
from services.agents import (
    agent_run_service,
    agent_task_service,
    paseo_execution_service,
    run_resume_service,
    task_execution_recovery_service,
)
from sqlalchemy.ext.asyncio import AsyncSession
from ws.manager import ws_manager
from ws.notifications import notify_module_data_changed


router = APIRouter()


@router.get("", response_model=list[AgentRunResponse])
async def list_runs(
    project_id: str | None = Query(None),
    status: AgentRunStatus | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await agent_run_service.list_runs(
        db, project_id=project_id, status=status, limit=limit
    )


@router.get("/{run_id}", response_model=AgentRunDetailResponse)
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    run = await agent_run_service.require_run(db, run_id)
    response = await agent_run_service.build_run_response(db, run)
    return AgentRunDetailResponse(
        **response.model_dump(mode="python"),
        result=run.result,
    )


@router.get("/{run_id}/events", response_model=list[AgentRunEventResponse])
async def get_run_events(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await agent_run_service.list_events(db, run_id)


def _active_provider(request: Request) -> tuple[str, object, str | None]:
    return run_resume_service.active_provider(request.app.state)


@router.post("/{run_id}/retry", response_model=AgentRunResponse, status_code=201)
async def retry_run(
    run_id: str,
    body: AgentRunRetryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    previous = await agent_run_service.require_run(db, run_id)
    if previous.status not in {
        AgentRunStatus.FAILED,
        AgentRunStatus.CANCELLED,
        AgentRunStatus.COMPLETED,
    }:
        raise ConflictError(f"Agent run cannot be retried from {previous.status}")
    task = await db.get(AgentTask, previous.agent_task_id)
    if task is None:
        raise NotFoundError("Agent task not found")
    await task_execution_recovery_service.validate_retryable_run(db, previous, task)
    provider = body.provider or previous.provider
    instruction = previous.instruction_snapshot
    if body.follow_up_instruction:
        instruction = (
            f"{instruction}\n\nFollow-up instruction:\n{body.follow_up_instruction.strip()}"
        )
        task.instruction = instruction
    if provider == "paseo":
        paseo_adapter = getattr(request.app.state, "paseo_adapter", None) or (
            paseo_execution_service.adapter_from_settings()
        )
        if not paseo_adapter.enabled:
            raise ConflictError("Paseo execution is disabled")
        await task_execution_recovery_service.claim_retryable_run(
            db,
            previous,
            task,
        )
        run = await agent_run_service.create_run(
            db,
            task,
            provider="paseo",
            model=body.model or previous.model,
            host_id=paseo_adapter.host_label,
            instruction_snapshot=instruction,
        )
        await db.commit()
        session_factory = request.app.state.session_factory
        agent_run_service.launch_execution(
            run.id,
            paseo_execution_service.execute_run(
                session_factory,
                run.id,
                user_id=user_id,
                adapter=paseo_adapter,
            ),
        )
        await notify_module_data_changed("runs")
        await notify_module_data_changed("todos")
        return await agent_run_service.build_run_response(db, run)

    active_provider, ai_service, active_model = _active_provider(request)
    if provider != active_provider:
        raise ConflictError(
            f"Execution provider {provider!r} is unavailable; active provider is {active_provider!r}"
        )
    await task_execution_recovery_service.claim_retryable_run(
        db,
        previous,
        task,
    )
    run = await agent_run_service.create_run(
        db,
        task,
        provider=provider,
        model=body.model or active_model,
        instruction_snapshot=instruction,
    )
    await db.commit()
    session_factory = request.app.state.session_factory

    async def execute() -> None:
        async with session_factory() as run_db:
            persisted_task = await run_db.get(AgentTask, task.id)
            persisted_run = await run_db.get(AgentRun, run.id)
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
                model=body.model or active_model,
            )

    agent_run_service.launch_execution(run.id, execute())
    await notify_module_data_changed("runs")
    await notify_module_data_changed("todos")
    return await agent_run_service.build_run_response(db, run)


@router.post("/{run_id}/resume", response_model=AgentRunResponse)
async def resume_run(
    run_id: str,
    body: AgentRunResumeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    run = await agent_run_service.require_run(db, run_id)
    task = await db.get(AgentTask, run.agent_task_id)
    if task is None:
        raise NotFoundError("Agent task not found")
    await run_resume_service.resume_with_follow_up(
        db,
        request.app.state,
        run,
        task,
        body.follow_up_instruction,
        user_id=user_id,
    )
    await notify_module_data_changed("runs")
    await notify_module_data_changed("reviews")
    return await agent_run_service.build_run_response(db, run)


@router.post("/{run_id}/cancel", response_model=AgentRunResponse)
async def cancel_run(
    run_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    persisted = await agent_run_service.require_run(db, run_id)
    run = await agent_run_service.cancel_run(db, run_id)
    external_cancel_error = None
    if persisted.provider == "paseo":
        adapter = getattr(request.app.state, "paseo_adapter", None) or (
            paseo_execution_service.adapter_from_settings()
        )
        external_cancel_error = await paseo_execution_service.cancel_external_run(
            persisted, adapter=adapter
        )
    if external_cancel_error:
        await agent_run_service.record_event(
            db,
            run,
            "external_cancel_unconfirmed",
            external_cancel_error,
            progress=run.progress,
        )
        await db.commit()
    await notify_module_data_changed("runs")
    return await agent_run_service.build_run_response(db, run)


@router.post(
    "/{run_id}/return-to-ready",
    response_model=AgentRunRecoveryResponse,
)
async def return_run_task_to_ready(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    result = await task_execution_recovery_service.return_task_to_ready(db, run_id)
    await db.commit()
    await notify_module_data_changed("runs")
    await notify_module_data_changed("todos")
    return result


@router.post("/{run_id}/result", response_model=AgentRunResponse)
async def report_run_result(
    run_id: str,
    body: AgentRunResultRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Finish a run executed elsewhere.

    A worker runs the CLI on its own machine and reports the outcome here, so
    the result lands in the same review flow as work the server ran itself.
    """
    run = await agent_run_service.require_run(db, run_id)
    if body.error:
        await agent_run_service.mark_failed(db, run, body.error)
    else:
        task = await db.get(AgentTask, run.agent_task_id)
        if task is None:
            raise NotFoundError("Agent task not found")
        await agent_run_service.mark_waiting_review(db, run, task, body.result or "")
    await db.commit()
    await notify_module_data_changed("runs")
    await notify_module_data_changed("todos")
    return await agent_run_service.build_run_response(db, run)


@router.post("/{run_id}/transition", response_model=AgentRunResponse)
async def transition_run(
    run_id: str,
    body: AgentRunTransitionRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    run = await agent_run_service.require_run(db, run_id)
    await agent_run_service.transition_run(db, run, body.status, body.message)
    await db.commit()
    await notify_module_data_changed("runs")
    return await agent_run_service.build_run_response(db, run)


@router.post("/{run_id}/heartbeat", response_model=AgentRunResponse)
async def heartbeat_run(
    run_id: str,
    body: AgentRunHeartbeatRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    run = await agent_run_service.require_run(db, run_id)
    if run.status not in {
        AgentRunStatus.STARTING,
        AgentRunStatus.RUNNING,
        AgentRunStatus.WAITING_INPUT,
    }:
        raise ConflictError(f"Agent run cannot heartbeat from {run.status}")
    run.heartbeat_at = datetime.now(timezone.utc)
    if body.progress is not None:
        run.progress = body.progress
    if body.message is not None:
        run.progress_message = body.message
    await agent_run_service.record_event(
        db,
        run,
        "heartbeat",
        body.message,
        progress=body.progress,
    )
    await db.commit()
    await notify_module_data_changed("runs")
    return await agent_run_service.build_run_response(db, run)
