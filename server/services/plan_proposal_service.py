"""Versioned task-plan proposal generation, application, and conservative undo."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import date, datetime, timezone

from domain.plan_proposal import (
    GLOBAL_TASK_GRAPH_SCOPE_ID,
    ChangeSetStatus,
    PlanProposalStatus,
    VaultSyncJobStatus,
)
from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType
from exceptions import (
    NotFoundError,
    PlanProposalConflictError,
    PlanValidationError,
    StalePlanProposalError,
)
from models.agent_task import AgentTask
from models.attachment import Attachment
from models.change_set import ChangeSet
from models.conversation import Conversation
from models.plan_proposal import PlanProposal
from models.project import Project
from models.task_graph_state import TaskGraphState
from models.todo import Todo
from models.vault_sync_job import VaultSyncJob
from schemas.task import (
    PlanApplyRequest,
    PlanApplyResponse,
    PlanPayload,
    PlanProposalDiff,
    PlanResponse,
    PlanSubtask,
    PlanUndoResponse,
    PlanValidationIssue,
    PlanValidationResult,
)
from skills import SKILL_REGISTRY
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id
from utils.vault_paths import normalize_vault_relative_path

from services import review_item_service, task_relationship_service, todo_planning_service
from services.plan_validation_service import (
    PlanOutputError,
    PlanSemanticError,
    require_valid_plan,
)

_ROOT_SNAPSHOT_FIELDS = (
    "enabled_skills",
    "assignee",
    "due_date",
    "source",
    "source_id",
    "inbox_state",
)

logger = logging.getLogger(__name__)


async def generate_proposal(
    db: AsyncSession,
    ai_service,
    todo_id: str,
    *,
    additional_instructions: str | None = None,
    model_provider: str | None = None,
) -> PlanResponse:
    """Generate one immutable proposal without holding a DB transaction over I/O."""
    todo = await db.get(Todo, todo_id)
    if todo is None:
        raise NotFoundError("Todo not found")
    base_revision = await _current_graph_revision(db, todo.project_id)

    context = await todo_planning_service.capture_planning_context(
        db,
        todo,
        additional_instructions=additional_instructions,
    )
    agent_task = AgentTask(
        id=make_id("task_"),
        agent_type="plan",
        task_type="plan_todo",
        todo_id=todo.id,
        instruction=additional_instructions or f"Plan subtasks for: {todo.title}",
        status="running",
        skill_chain='["plan"]',
        started_at=datetime.now(timezone.utc),
    )
    proposal = PlanProposal(
        id=make_id("proposal_"),
        root_task_id=todo.id,
        project_id=todo.project_id,
        agent_task_id=agent_task.id,
        base_graph_revision=base_revision,
        model_provider=model_provider,
        model_name=getattr(ai_service, "model", None),
        prompt_version=todo_planning_service.PROMPT_VERSION,
        status=PlanProposalStatus.GENERATING,
        is_revertible=True,
    )
    db.add_all([agent_task, proposal])
    todo.inbox_state = "planning"
    await db.commit()

    try:
        external_context = await asyncio.to_thread(
            todo_planning_service.read_external_planning_context,
            context,
        )
        context_hash = _context_hash(context, external_context)
        plan = await todo_planning_service.generate_plan(
            ai_service,
            context,
            external_context,
        )
        validation = require_valid_plan(
            plan,
            existing_child_titles=context.child_titles,
            allowed_skills=SKILL_REGISTRY,
            effective_root_due_date=context.root_due_date,
        )
    except (PlanOutputError, PlanSemanticError) as exc:
        validation = _generation_error_validation(exc)
        await _mark_generation_failed(
            db,
            proposal.id,
            agent_task.id,
            todo_id,
            validation,
            str(exc),
        )
        raise
    except Exception as exc:
        validation = PlanValidationResult(
            errors=[
                PlanValidationIssue(
                    code="provider_error",
                    message="The AI provider failed to generate a plan",
                )
            ]
        )
        await _mark_generation_failed(
            db,
            proposal.id,
            agent_task.id,
            todo_id,
            validation,
            str(exc),
        )
        raise

    proposal_id = proposal.id
    agent_task_id = agent_task.id
    base_revision = proposal.base_graph_revision
    try:
        # Event and Vault inputs do not bump the task-graph revision. Re-read
        # both after the model returns so a proposal generated from changed
        # prompt context is saved for inspection but never advertised as draft.
        latest_external_context = await asyncio.to_thread(
            todo_planning_service.read_external_planning_context,
            context,
        )
        refreshed_todo = (
            await db.execute(
                select(Todo)
                .where(Todo.id == todo_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        refreshed_context = (
            await todo_planning_service.capture_planning_context(
                db,
                refreshed_todo,
                additional_instructions=additional_instructions,
            )
            if refreshed_todo is not None
            else None
        )
        context_is_current = (
            refreshed_context is not None
            and _context_hash(refreshed_context, latest_external_context)
            == context_hash
        )

        # First write after LLM execution: lock the graph state only if the
        # task graph snapshot is still current. The context reads above and
        # this CAS share one DB transaction, closing the DB-side TOCTOU window.
        claimed_revision = await _claim_graph_revision(
            db,
            proposal.project_id,
            base_revision,
        )
        if claimed_revision is None:
            await db.rollback()
        proposal = (
            await db.execute(
                select(PlanProposal)
                .where(PlanProposal.id == proposal_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        agent_task = (
            await db.execute(
                select(AgentTask)
                .where(AgentTask.id == agent_task_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        todo = (
            await db.execute(
                select(Todo)
                .where(Todo.id == todo_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if not context_is_current:
            validation.warnings.append(
                PlanValidationIssue(
                    code="planning_context_changed",
                    message=(
                        "Planning context changed while the proposal was being "
                        "generated; regenerate before applying"
                    ),
                )
            )
        proposal.context_hash = context_hash
        payload_json = _json_dump(plan.model_dump(mode="json"))
        proposal.payload_json = payload_json
        proposal.validation_json = _json_dump(validation.model_dump(mode="json"))
        if proposal.status == PlanProposalStatus.GENERATING:
            proposal.status = (
                PlanProposalStatus.DRAFT
                if claimed_revision is not None and context_is_current
                else PlanProposalStatus.STALE
            )
        agent_task.payload_json = payload_json
        agent_task.status = "completed"
        agent_task.completed_at = datetime.now(timezone.utc)
        if todo is not None:
            if proposal.status == PlanProposalStatus.DRAFT:
                todo.inbox_state = "plan_ready"
                todo.automation_error = None
                await review_item_service.ensure_review_item(
                    db,
                    subject_type=ReviewSubjectType.PLAN_PROPOSAL,
                    subject_id=proposal.id,
                    project_id=proposal.project_id,
                    summary=plan.summary or f"Review AI plan for {todo.title}",
                    risk_level=ReviewRiskLevel.MEDIUM,
                )
            elif proposal.status != PlanProposalStatus.REJECTED:
                todo.inbox_state = "none"
        await db.commit()
    except Exception as exc:
        recovered_proposal = await _recover_generation_finalization_failure(
            db,
            proposal_id,
            agent_task_id,
            todo_id,
            exc,
        )
        if recovered_proposal is not None:
            recovered_root = (
                await db.get(Todo, recovered_proposal.root_task_id)
                if recovered_proposal.root_task_id is not None
                else None
            )
            if recovered_root is None:
                raise NotFoundError(
                    "Todo was deleted while the plan was being generated"
                ) from exc
            return await build_plan_response(db, recovered_proposal)
        raise
    if todo is None:
        raise NotFoundError("Todo was deleted while the plan was being generated")
    return await build_plan_response(db, proposal)


async def get_latest_proposal(db: AsyncSession, todo_id: str) -> PlanProposal:
    proposal = (
        await db.execute(
            select(PlanProposal)
            .where(
                PlanProposal.root_task_id == todo_id,
                PlanProposal.status.notin_(
                    [PlanProposalStatus.GENERATING, PlanProposalStatus.FAILED]
                ),
            )
            .order_by(PlanProposal.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if proposal is None:
        raise NotFoundError("No plan found")
    return proposal


async def build_plan_response(
    db: AsyncSession,
    proposal: PlanProposal,
) -> PlanResponse:
    payload, compatibility_validation = _decode_proposal_payload(proposal)
    validation = _decode_validation(proposal.validation_json)
    if compatibility_validation is not None:
        validation.errors.append(compatibility_validation)
    root = (
        await db.get(Todo, proposal.root_task_id)
        if proposal.root_task_id is not None
        else None
    )
    diff = _proposal_diff(payload.subtasks, payload, root)
    due_dates = sorted(
        subtask.due_date for subtask in payload.subtasks if subtask.due_date
    )
    due_summary = None
    if due_dates:
        due_summary = (
            due_dates[0].isoformat()
            if due_dates[0] == due_dates[-1]
            else f"{due_dates[0].isoformat()} – {due_dates[-1].isoformat()}"
        )
    suggested_skills = payload.suggested_skills
    return PlanResponse(
        proposal_id=proposal.id,
        task_id=proposal.id,
        agent_task_id=proposal.agent_task_id,
        todo_id=proposal.root_task_id or "",
        base_graph_revision=proposal.base_graph_revision,
        status=PlanProposalStatus(proposal.status),
        validation=validation,
        diff=diff,
        summary=payload.summary,
        suggested_root_due_date=payload.suggested_root_due_date,
        suggested_assignee=payload.suggested_assignee,
        suggested_skills=suggested_skills or None,
        suggested_project_title=payload.suggested_project_title,
        subtasks=payload.subtasks,
        created_at=proposal.created_at,
        subtask_count=len(payload.subtasks),
        suggested_due_summary=due_summary,
        suggested_assignee_label=(
            _skill_label(payload.suggested_assignee)
            if payload.suggested_assignee
            else None
        ),
        suggested_skills_labels=[_skill_label(skill) for skill in suggested_skills]
        or None,
        suggested_project_label=_humanize_project_title(
            payload.suggested_project_title
        ),
    )


async def apply_proposal(
    db: AsyncSession,
    todo_id: str,
    request: PlanApplyRequest,
) -> tuple[PlanApplyResponse, str | None]:
    """Apply one exact proposal with CAS, idempotency, and one DB commit."""
    request_hash = canonical_apply_request_hash(request)

    # Deliberately the first DB statement: acquire the global writer/row lock
    # only when the revision still matches the user's preview.
    proposal_project_id = (
        await db.execute(
            select(PlanProposal.project_id).where(
                PlanProposal.id == request.proposal_id
            )
        )
    ).scalar_one_or_none()
    claimed_revision = await _claim_graph_revision(
        db,
        proposal_project_id,
        request.base_graph_revision,
    )
    if claimed_revision is None:
        await db.rollback()
        replay = await _replay_apply(db, request.proposal_id, request_hash)
        if replay is not None:
            return replay
        await _mark_stale_and_raise(
            db,
            todo_id,
            request.proposal_id,
            request.base_graph_revision,
        )

    try:
        proposal = await db.get(PlanProposal, request.proposal_id)
        if proposal is None or proposal.root_task_id != todo_id:
            raise NotFoundError("Plan proposal not found")
        if proposal.base_graph_revision is None or not proposal.is_revertible:
            raise PlanProposalConflictError(
                "Legacy proposals cannot be applied; generate a fresh plan"
            )
        if proposal.base_graph_revision != request.base_graph_revision:
            raise StalePlanProposalError(
                base_revision=proposal.base_graph_revision,
                current_revision=claimed_revision,
            )
        if proposal.status != PlanProposalStatus.DRAFT:
            raise PlanProposalConflictError(
                f"Plan proposal cannot be applied from status {proposal.status}"
            )
        todo = await db.get(Todo, todo_id)
        if todo is None:
            raise NotFoundError("Todo not found")

        original_plan = PlanPayload.model_validate_json(proposal.payload_json or "{}")
        if request.subtasks is not None and len(request.subtasks) != len(
            original_plan.subtasks
        ):
            raise PlanValidationError(
                "Edited subtasks must preserve proposal index identity",
                details=PlanValidationResult(
                    errors=[
                        PlanValidationIssue(
                            code="subtask_cardinality_changed",
                            message=(
                                "Edited subtasks must contain exactly the proposal's "
                                "original number of entries; use selected_indices to "
                                "exclude tasks"
                            ),
                            path="subtasks",
                        )
                    ]
                ).model_dump(mode="json"),
            )
        approved_plan = (
            PlanPayload.model_validate(
                {
                    **original_plan.model_dump(mode="json"),
                    "subtasks": [
                        subtask.model_dump(mode="json") for subtask in request.subtasks
                    ],
                }
            )
            if request.subtasks is not None
            else original_plan
        )
        selected_indices = (
            request.selected_indices
            if request.selected_indices is not None
            else list(range(len(approved_plan.subtasks)))
        )
        existing_children = list(
            (
                await db.execute(
                    select(Todo)
                    .where(Todo.parent_id == todo_id)
                    .order_by(Todo.sort_order)
                )
            )
            .scalars()
            .all()
        )
        require_valid_plan(
            approved_plan,
            selected_indices=selected_indices,
            existing_child_titles=[child.title for child in existing_children],
            allowed_skills=SKILL_REGISTRY,
            effective_root_due_date=(todo.due_date.date() if todo.due_date else None),
        )

        proposal.status = PlanProposalStatus.APPLYING
        change_set = ChangeSet(
            id=make_id("changeset_"),
            proposal_id=proposal.id,
            request_hash=request_hash,
            base_graph_revision=request.base_graph_revision,
            status=ChangeSetStatus.APPLYING,
            operations_json="{}",
            inverse_operations_json="{}",
        )
        db.add(change_set)
        await db.flush()

        root_before = _root_snapshot(todo)
        next_sort_order = (
            max(
                (child.sort_order for child in existing_children),
                default=-1,
            )
            + 1
        )
        created_todos: list[Todo] = []
        created_by_index: dict[int, Todo] = {}
        for offset, original_index in enumerate(selected_indices):
            subtask = approved_plan.subtasks[original_index]
            child = Todo(
                id=make_id("todo_"),
                project_id=todo.project_id,
                parent_id=todo_id,
                title=subtask.title,
                description=subtask.description,
                estimated_minutes=subtask.estimated_minutes,
                due_date=_date_to_datetime(subtask.due_date),
                priority=subtask.priority or "medium",
                sort_order=next_sort_order + offset,
            )
            db.add(child)
            created_todos.append(child)
            created_by_index[original_index] = child
        await db.flush()

        created_relationship_ids: list[str] = []
        for original_index in selected_indices:
            source = created_by_index[original_index]
            dependencies = [
                created_by_index[index].id
                for index in approved_plan.subtasks[original_index].depends_on_indices
            ]
            relationships = await task_relationship_service.replace_task_dependencies(
                db,
                source.id,
                dependencies,
                created_by="ai",
                proposal_id=proposal.id,
            )
            created_relationship_ids.extend(
                relationship.id for relationship in relationships
            )

        root_update_fields = _apply_root_suggestions(todo, approved_plan)
        if not todo.due_date:
            child_due_dates = [
                child.due_date for child in created_todos if child.due_date
            ]
            if child_due_dates:
                # A root due date represents project completion. It must not
                # precede any selected child deadline.
                todo.due_date = max(child_due_dates)
                root_update_fields.append("due_date")
        todo.inbox_state = "none"
        await db.flush()

        applied_revision = await _current_graph_revision(db, proposal.project_id)
        now = datetime.now(timezone.utc)
        root_after = _root_snapshot(todo)
        approved_payload = approved_plan.model_dump(mode="json")
        operations = {
            "approved_plan": approved_payload,
            "selected_indices": selected_indices,
            "created_todo_ids": [child.id for child in created_todos],
            "created_relationship_ids": created_relationship_ids,
            "root_before": root_before,
            "root_after": root_after,
            "root_update_fields": root_update_fields,
        }
        inverse_operations = {
            "delete_todo_ids": [child.id for child in created_todos],
            "delete_relationship_ids": created_relationship_ids,
            "restore_root": root_before,
        }
        response = PlanApplyResponse(
            todo_id=todo_id,
            proposal_id=proposal.id,
            change_set_id=change_set.id,
            applied_graph_revision=applied_revision,
            created_subtask_ids=[child.id for child in created_todos],
            created_relationships=len(created_relationship_ids),
            root_update_fields=root_update_fields,
            project_folder_created=None,
            already_applied=False,
            can_undo=True,
            vault_sync_status=VaultSyncJobStatus.PENDING,
        )
        change_set.operations_json = _json_dump(operations)
        change_set.inverse_operations_json = _json_dump(inverse_operations)
        change_set.response_json = _json_dump(response.model_dump(mode="json"))
        change_set.applied_graph_revision = applied_revision
        change_set.status = ChangeSetStatus.APPLIED
        change_set.applied_at = now
        proposal.status = PlanProposalStatus.APPLIED
        proposal.applied_at = now
        review_item = await review_item_service.ensure_review_item(
            db,
            subject_type=ReviewSubjectType.PLAN_PROPOSAL,
            subject_id=proposal.id,
            project_id=proposal.project_id,
            summary=approved_plan.summary or f"Review AI plan for {todo.title}",
            risk_level=ReviewRiskLevel.MEDIUM,
        )
        review_item.status = ReviewStatus.APPROVED
        review_item.reviewed_at = now
        job = _vault_job(
            change_set,
            event_type="task_plan_applied",
            aggregate_id=todo_id,
            todo_ids=[todo_id, *response.created_subtask_ids],
            removed_todo_ids=[],
            revision=applied_revision,
        )
        db.add(job)
        await db.commit()
        return response, job.id
    except IntegrityError:
        await db.rollback()
        replay = await _replay_apply(db, request.proposal_id, request_hash)
        if replay is not None:
            return replay
        raise PlanProposalConflictError("The plan proposal is already being applied")
    except PlanSemanticError as exc:
        await db.rollback()
        raise PlanValidationError(
            "The edited plan contains invalid graph semantics",
            details=exc.result.model_dump(mode="json"),
        ) from exc
    except Exception:
        await db.rollback()
        raise


async def dismiss_proposal(
    db: AsyncSession,
    todo_id: str,
    proposal_id: str,
) -> dict[str, str]:
    proposal = await db.get(PlanProposal, proposal_id)
    if proposal is None or proposal.root_task_id != todo_id:
        raise NotFoundError("Plan proposal not found")
    if proposal.status == PlanProposalStatus.REJECTED:
        return {"status": "rejected", "todo_id": todo_id, "proposal_id": proposal_id}
    if proposal.status in (
        PlanProposalStatus.GENERATING,
        PlanProposalStatus.APPLYING,
    ):
        raise PlanProposalConflictError(
            f"Plan proposal cannot be dismissed from status {proposal.status}"
        )
    if proposal.status in (PlanProposalStatus.APPLIED, PlanProposalStatus.REVERTED):
        raise PlanProposalConflictError("An applied proposal cannot be dismissed")
    proposal.status = PlanProposalStatus.REJECTED
    review_item = await review_item_service.ensure_review_item(
        db,
        subject_type=ReviewSubjectType.PLAN_PROPOSAL,
        subject_id=proposal.id,
        project_id=proposal.project_id,
        summary=f"Review AI plan for {todo_id}",
        risk_level=ReviewRiskLevel.MEDIUM,
    )
    review_item.status = ReviewStatus.REJECTED
    review_item.reviewed_at = datetime.now(timezone.utc)
    todo = await db.get(Todo, todo_id)
    if todo is not None:
        todo.inbox_state = "none"
    await db.commit()
    return {"status": "rejected", "todo_id": todo_id, "proposal_id": proposal_id}


async def revert_change_set(
    db: AsyncSession,
    change_set_id: str,
) -> tuple[PlanUndoResponse, str | None]:
    """Undo only when no graph mutation occurred after the original apply."""
    expected_revision = (
        select(ChangeSet.applied_graph_revision)
        .where(
            ChangeSet.id == change_set_id,
            ChangeSet.status == ChangeSetStatus.APPLIED,
        )
        .scalar_subquery()
    )
    proposal_project_id = (
        await db.execute(
            select(PlanProposal.project_id)
            .join(ChangeSet, ChangeSet.proposal_id == PlanProposal.id)
            .where(ChangeSet.id == change_set_id)
        )
    ).scalar_one_or_none()
    claimed_revision = await _claim_graph_revision(
        db,
        proposal_project_id,
        expected_revision,
    )
    if claimed_revision is None:
        await db.rollback()
        replay = await _replay_undo(db, change_set_id)
        if replay is not None:
            return replay
        change_set = await db.get(ChangeSet, change_set_id)
        if change_set is None:
            raise NotFoundError("Change set not found")
        current_revision = await _current_graph_revision(db, proposal_project_id)
        raise StalePlanProposalError(
            base_revision=change_set.applied_graph_revision,
            current_revision=current_revision,
        )

    try:
        change_set = await db.get(ChangeSet, change_set_id)
        assert change_set is not None
        proposal = await db.get(PlanProposal, change_set.proposal_id)
        if proposal is None:
            raise NotFoundError("Plan proposal not found")
        if not proposal.is_revertible or proposal.base_graph_revision is None:
            raise PlanProposalConflictError("Legacy proposals cannot be reverted")
        if change_set.status != ChangeSetStatus.APPLIED:
            raise PlanProposalConflictError(
                f"Change set cannot be reverted from status {change_set.status}"
            )
        inverse = json.loads(change_set.inverse_operations_json)
        todo_ids = list(inverse.get("delete_todo_ids", []))
        root_snapshot = inverse.get("restore_root", {})
        root_id = proposal.root_task_id
        if root_id is None:
            raise PlanProposalConflictError("The root task no longer exists")
        root = await db.get(Todo, root_id)
        if root is None:
            raise PlanProposalConflictError("The root task no longer exists")

        await _ensure_no_undo_side_effect_references(db, todo_ids)

        for todo_id in todo_ids:
            child = await db.get(Todo, todo_id)
            if child is None:
                raise PlanProposalConflictError(
                    "A generated subtask no longer exists; undo was refused"
                )
            await db.delete(child)
        _restore_root_snapshot(root, root_snapshot)
        # Reverted proposals are deliberately non-reapplicable. Do not expose
        # the old plan_ready workflow state again after undo.
        root.inbox_state = "none"
        await db.flush()
        reverted_revision = await _current_graph_revision(db, proposal.project_id)
        response = PlanUndoResponse(
            change_set_id=change_set.id,
            proposal_id=proposal.id,
            todo_id=root.id,
            reverted_graph_revision=reverted_revision,
            reverted_subtask_ids=todo_ids,
            already_reverted=False,
            vault_sync_status=VaultSyncJobStatus.PENDING,
        )
        change_set.status = ChangeSetStatus.REVERTED
        change_set.reverted_graph_revision = reverted_revision
        change_set.reverted_at = datetime.now(timezone.utc)
        change_set.undo_response_json = _json_dump(response.model_dump(mode="json"))
        proposal.status = PlanProposalStatus.REVERTED
        proposal.is_revertible = False
        job = _vault_job(
            change_set,
            event_type="task_plan_reverted",
            aggregate_id=root.id,
            todo_ids=[root.id],
            removed_todo_ids=todo_ids,
            revision=reverted_revision,
        )
        db.add(job)
        await db.commit()
        return response, job.id
    except Exception:
        await db.rollback()
        raise


def canonical_apply_request_hash(request: PlanApplyRequest) -> str:
    canonical = _json_dump(request.model_dump(mode="json"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _replay_apply(
    db: AsyncSession,
    proposal_id: str,
    request_hash: str,
) -> tuple[PlanApplyResponse, str | None] | None:
    change_set = (
        await db.execute(select(ChangeSet).where(ChangeSet.proposal_id == proposal_id))
    ).scalar_one_or_none()
    if change_set is None:
        return None
    if change_set.request_hash != request_hash:
        raise PlanProposalConflictError(
            "This proposal was already applied with different edits",
            details={"change_set_id": change_set.id},
        )
    if change_set.status == ChangeSetStatus.REVERTED:
        raise PlanProposalConflictError(
            "This proposal was already applied and reverted; generate a new plan"
        )
    if change_set.status != ChangeSetStatus.APPLIED or not change_set.response_json:
        raise PlanProposalConflictError("This proposal is already being applied")
    response = PlanApplyResponse.model_validate_json(change_set.response_json)
    job_id = await _delivery_job_id(db, change_set.id, "task_plan_applied")
    return response.model_copy(update={"already_applied": True}), job_id


async def _replay_undo(
    db: AsyncSession,
    change_set_id: str,
) -> tuple[PlanUndoResponse, str | None] | None:
    change_set = await db.get(ChangeSet, change_set_id)
    if change_set is None:
        return None
    if change_set.status == ChangeSetStatus.REVERTED and change_set.undo_response_json:
        response = PlanUndoResponse.model_validate_json(change_set.undo_response_json)
        job_id = await _delivery_job_id(db, change_set.id, "task_plan_reverted")
        return response.model_copy(update={"already_reverted": True}), job_id
    return None


async def _delivery_job_id(
    db: AsyncSession,
    change_set_id: str,
    event_type: str,
) -> str | None:
    return (
        await db.execute(
            select(VaultSyncJob.id).where(
                VaultSyncJob.change_set_id == change_set_id,
                VaultSyncJob.event_type == event_type,
                VaultSyncJob.status != VaultSyncJobStatus.SUCCEEDED,
            )
        )
    ).scalar_one_or_none()


async def _mark_stale_and_raise(
    db: AsyncSession,
    todo_id: str,
    proposal_id: str,
    requested_base_revision: int,
) -> None:
    proposal = await db.get(PlanProposal, proposal_id)
    if proposal is None or proposal.root_task_id != todo_id:
        raise NotFoundError("Plan proposal not found")
    current_revision = await _current_graph_revision(db, proposal.project_id)
    if proposal.status == PlanProposalStatus.DRAFT:
        proposal.status = PlanProposalStatus.STALE
        await review_item_service.set_subject_review_status(
            db,
            ReviewSubjectType.PLAN_PROPOSAL,
            proposal.id,
            ReviewStatus.EXPIRED,
        )
        await db.commit()
    else:
        await db.rollback()
    raise StalePlanProposalError(
        base_revision=(
            proposal.base_graph_revision
            if proposal.base_graph_revision is not None
            else requested_base_revision
        ),
        current_revision=current_revision,
    )


async def _mark_generation_failed(
    db: AsyncSession,
    proposal_id: str,
    agent_task_id: str,
    todo_id: str,
    validation: PlanValidationResult,
    error: str,
) -> None:
    await db.rollback()
    proposal = await db.get(PlanProposal, proposal_id)
    agent_task = await db.get(AgentTask, agent_task_id)
    todo = await db.get(Todo, todo_id)
    if proposal is not None and proposal.status == PlanProposalStatus.GENERATING:
        proposal.status = PlanProposalStatus.FAILED
        proposal.validation_json = _json_dump(validation.model_dump(mode="json"))
    if agent_task is not None:
        agent_task.status = "failed"
        agent_task.error = error
        agent_task.completed_at = datetime.now(timezone.utc)
    if todo is not None:
        todo.inbox_state = "error"
        todo.automation_error = error
    await db.commit()


async def _recover_generation_finalization_failure(
    db: AsyncSession,
    proposal_id: str,
    agent_task_id: str,
    todo_id: str,
    error: Exception,
) -> PlanProposal | None:
    """Resolve an ambiguous final commit or durably mark an uncommitted failure."""
    validation = PlanValidationResult(
        errors=[
            PlanValidationIssue(
                code="plan_finalization_error",
                message="The generated plan could not be finalized",
            )
        ]
    )
    try:
        await db.rollback()
        proposal = (
            await db.execute(
                select(PlanProposal)
                .where(PlanProposal.id == proposal_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        agent_task = (
            await db.execute(
                select(AgentTask)
                .where(AgentTask.id == agent_task_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            proposal is not None
            and proposal.status in (PlanProposalStatus.DRAFT, PlanProposalStatus.STALE)
            and agent_task is not None
            and agent_task.status == "completed"
        ):
            # The DB commit succeeded and only acknowledgement failed. Keep the
            # coherent durable result instead of corrupting it into failed/error.
            return proposal
        await _mark_generation_failed(
            db,
            proposal_id,
            agent_task_id,
            todo_id,
            validation,
            str(error),
        )
    except Exception:
        logger.exception(
            "Failed to persist recovery state for plan proposal %s",
            proposal_id,
        )
    return None


async def _claim_graph_revision(
    db: AsyncSession,
    project_id: str | None,
    expected_revision,
) -> int | None:
    if project_id is not None:
        return (
            await db.execute(
                update(Project)
                .where(
                    Project.id == project_id,
                    Project.graph_revision == expected_revision,
                )
                .values(graph_revision=Project.graph_revision)
                .returning(Project.graph_revision)
            )
        ).scalar_one_or_none()
    return (
        await db.execute(
            update(TaskGraphState)
            .where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID,
                TaskGraphState.revision == expected_revision,
            )
            .values(revision=TaskGraphState.revision)
            .returning(TaskGraphState.revision)
        )
    ).scalar_one_or_none()


async def _current_graph_revision(
    db: AsyncSession,
    project_id: str | None = None,
) -> int:
    if project_id is not None:
        revision = (
            await db.execute(
                select(Project.graph_revision).where(Project.id == project_id)
            )
        ).scalar_one_or_none()
        if revision is None:
            raise RuntimeError(f"Project {project_id} is not initialized")
        return revision
    revision = (
        await db.execute(
            select(TaskGraphState.revision).where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID
            )
        )
    ).scalar_one_or_none()
    if revision is None:
        raise RuntimeError("Global task graph state is not initialized")
    return revision


async def _ensure_no_undo_side_effect_references(
    db: AsyncSession,
    todo_ids: list[str],
) -> None:
    if not todo_ids:
        return
    checks = (
        (Attachment.todo_id, "attachment"),
        (AgentTask.todo_id, "agent run"),
        (Conversation.project_todo_id, "conversation"),
        (PlanProposal.root_task_id, "plan proposal"),
    )
    for column, label in checks:
        reference = (
            await db.execute(select(column).where(column.in_(todo_ids)).limit(1))
        ).scalar_one_or_none()
        if reference is not None:
            raise PlanProposalConflictError(
                f"A generated subtask has a linked {label}; undo was refused"
            )


def _context_hash(context, external_context) -> str:
    canonical = _json_dump(
        {
            "prompt_version": todo_planning_service.PROMPT_VERSION,
            "database": context.canonical_dict(),
            "external": external_context.canonical_dict(),
        }
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _decode_proposal_payload(
    proposal: PlanProposal,
) -> tuple[PlanPayload, PlanValidationIssue | None]:
    try:
        return PlanPayload.model_validate_json(proposal.payload_json or "{}"), None
    except (TypeError, ValueError):
        raw: dict = {}
        try:
            candidate = json.loads(proposal.payload_json or "{}")
            if isinstance(candidate, dict):
                raw = candidate
        except (json.JSONDecodeError, TypeError):
            pass
        return (
            PlanPayload.model_construct(
                summary=str(raw.get("summary", "Legacy plan requires regeneration")),
                suggested_root_due_date=None,
                suggested_skills=[],
                suggested_assignee=None,
                suggested_project_title=None,
                subtasks=[],
            ),
            PlanValidationIssue(
                code="legacy_plan_requires_regeneration",
                message="This legacy plan cannot be safely validated or applied",
            ),
        )


def _decode_validation(value: str | None) -> PlanValidationResult:
    if not value:
        return PlanValidationResult()
    try:
        return PlanValidationResult.model_validate_json(value)
    except (TypeError, ValueError):
        return PlanValidationResult(
            warnings=[
                PlanValidationIssue(
                    code="invalid_legacy_validation",
                    message="Stored legacy validation metadata could not be decoded",
                )
            ]
        )


def _generation_error_validation(
    exc: PlanOutputError | PlanSemanticError,
) -> PlanValidationResult:
    if isinstance(exc, PlanSemanticError):
        return exc.result
    return PlanValidationResult(
        errors=[
            PlanValidationIssue(
                code="invalid_ai_output",
                message=str(exc),
            )
        ]
    )


def _proposal_diff(
    subtasks: list[PlanSubtask],
    payload: PlanPayload,
    root: Todo | None,
) -> PlanProposalDiff:
    relationships = sum(len(subtask.depends_on_indices) for subtask in subtasks)
    root_fields: list[str] = []
    if root is not None:
        if payload.suggested_skills:
            if _decode_enabled_skills(root.enabled_skills) != payload.suggested_skills:
                root_fields.append("enabled_skills")
            if root.assignee != payload.suggested_skills[0]:
                root_fields.append("assignee")
        elif payload.suggested_assignee and root.assignee != payload.suggested_assignee:
            root_fields.append("assignee")
        if payload.suggested_root_due_date:
            if _todo_due_date(root) != payload.suggested_root_due_date:
                root_fields.append("due_date")
        elif root.due_date is None and any(subtask.due_date for subtask in subtasks):
            root_fields.append("due_date")
        if payload.suggested_project_title and not root.source_id:
            source_id = _safe_project_source_id(payload.suggested_project_title)
            if root.source != "obsidian_project":
                root_fields.append("source")
            if root.source_id != source_id:
                root_fields.append("source_id")
    return PlanProposalDiff(
        add_task_count=len(subtasks),
        add_relationship_count=relationships,
        root_update_fields=list(dict.fromkeys(root_fields)),
    )


def _apply_root_suggestions(todo: Todo, plan: PlanPayload) -> list[str]:
    changed: list[str] = []
    if plan.suggested_skills:
        serialized_skills = _json_dump(plan.suggested_skills)
        if _decode_enabled_skills(todo.enabled_skills) != plan.suggested_skills:
            todo.enabled_skills = serialized_skills
            changed.append("enabled_skills")
        if todo.assignee != plan.suggested_skills[0]:
            todo.assignee = plan.suggested_skills[0]
            changed.append("assignee")
    elif plan.suggested_assignee and todo.assignee != plan.suggested_assignee:
        todo.assignee = plan.suggested_assignee
        changed.append("assignee")
    suggested_due_date = _date_to_datetime(plan.suggested_root_due_date)
    if suggested_due_date and _todo_due_date(todo) != plan.suggested_root_due_date:
        todo.due_date = suggested_due_date
        changed.append("due_date")
    if plan.suggested_project_title and not todo.source_id:
        source_id = _safe_project_source_id(plan.suggested_project_title)
        if todo.source != "obsidian_project":
            todo.source = "obsidian_project"
            changed.append("source")
        if todo.source_id != source_id:
            todo.source_id = source_id
            changed.append("source_id")
    return list(dict.fromkeys(changed))


def _safe_project_source_id(title: str) -> str:
    sanitized = re.sub(r'[<>:"/\\|?*\x00]', "_", title).strip().rstrip(".")
    sanitized = re.sub(r"\s+", "_", sanitized)
    return normalize_vault_relative_path(sanitized)


def _root_snapshot(todo: Todo) -> dict[str, object]:
    result: dict[str, object] = {}
    for field_name in _ROOT_SNAPSHOT_FIELDS:
        value = getattr(todo, field_name)
        result[field_name] = value.isoformat() if isinstance(value, datetime) else value
    return result


def _restore_root_snapshot(todo: Todo, snapshot: dict[str, object]) -> None:
    for field_name in _ROOT_SNAPSHOT_FIELDS:
        if field_name not in snapshot:
            raise PlanProposalConflictError(
                f"Change set is missing root snapshot field {field_name}"
            )
        value = snapshot[field_name]
        if field_name == "due_date" and isinstance(value, str):
            value = datetime.fromisoformat(value)
        setattr(todo, field_name, value)


def _vault_job(
    change_set: ChangeSet,
    *,
    event_type: str,
    aggregate_id: str,
    todo_ids: list[str],
    removed_todo_ids: list[str],
    revision: int,
) -> VaultSyncJob:
    return VaultSyncJob(
        change_set_id=change_set.id,
        event_type=event_type,
        aggregate_id=aggregate_id,
        payload_json=_json_dump(
            {
                "todo_ids": todo_ids,
                "removed_todo_ids": removed_todo_ids,
                "graph_revision": revision,
            }
        ),
        dedupe_key=f"{change_set.id}:{event_type}",
        status=VaultSyncJobStatus.PENDING,
    )


def _date_to_datetime(value: date | None) -> datetime | None:
    if value is None:
        return None
    return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)


def _todo_due_date(todo: Todo) -> date | None:
    return todo.due_date.date() if todo.due_date else None


def _decode_enabled_skills(value: str | None) -> list[str] | None:
    if not value:
        return None
    try:
        decoded = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(decoded, list) or not all(
        isinstance(item, str) for item in decoded
    ):
        return None
    return decoded


def _json_dump(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _skill_label(skill_id: str) -> str:
    skill = SKILL_REGISTRY.get(skill_id)
    return skill.name if skill else skill_id.replace("_", " ").title()


def _humanize_project_title(value: str | None) -> str | None:
    if not value:
        return None
    return value.replace("_", " ").replace("-", " ").strip().title()
