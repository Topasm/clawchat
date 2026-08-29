"""HTTP API for normalized task relationships."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from domain.task_relationship import TaskRelationshipType
from schemas.common import ErrorResponse
from schemas.task_relationship import (
    TaskDependencyCommandRequest,
    TaskDependencyCommandResponse,
    TaskDependencyPreviewResponse,
    TaskRelationshipCreate,
    TaskRelationshipResponse,
    TaskRelationshipUpdate,
)
from services.tasks import task_relationship_service
from ws.notifications import notify_module_data_changed

router = APIRouter()

_VALIDATION_RESPONSE = {
    400: {
        "model": ErrorResponse,
        "description": "Invalid task relationship graph",
    }
}
_CONFLICT_RESPONSE = {
    409: {
        "model": ErrorResponse,
        "description": "Task relationship already exists or conflicts",
    }
}
_NOT_FOUND_RESPONSE = {
    404: {
        "model": ErrorResponse,
        "description": "Task relationship not found",
    }
}


@router.get("", response_model=list[TaskRelationshipResponse])
async def list_task_relationships(
    task_id: str | None = None,
    source_task_id: str | None = None,
    target_task_id: str | None = None,
    relationship_type: TaskRelationshipType | None = Query(default=None, alias="type"),
    limit: int = Query(default=5000, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await task_relationship_service.list_relationships(
        db,
        task_id=task_id,
        source_task_id=source_task_id,
        target_task_id=target_task_id,
        relationship_type=relationship_type,
        limit=limit,
    )


@router.post(
    "",
    response_model=TaskRelationshipResponse,
    status_code=201,
    responses={**_VALIDATION_RESPONSE, **_CONFLICT_RESPONSE},
)
async def create_task_relationship(
    body: TaskRelationshipCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    relationship = await task_relationship_service.create_relationship(db, body)
    await db.commit()
    await db.refresh(relationship)
    await notify_module_data_changed("todos")
    return relationship


@router.post(
    "/commands/dependency/preview",
    response_model=TaskDependencyPreviewResponse,
    responses={**_VALIDATION_RESPONSE, **_CONFLICT_RESPONSE},
)
async def preview_task_dependency(
    body: TaskDependencyCommandRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    affected_ids, insights_delta = (
        await task_relationship_service.preview_dependency_command(db, body)
    )
    return TaskDependencyPreviewResponse(
        dependent_task_id=body.dependent_task_id,
        prerequisite_task_id=body.prerequisite_task_id,
        base_graph_revision=body.expected_graph_revision,
        affected_task_ids=affected_ids,
        insights_delta=insights_delta,
    )


@router.post(
    "/commands/dependency",
    response_model=TaskDependencyCommandResponse,
    status_code=201,
    responses={**_VALIDATION_RESPONSE, **_CONFLICT_RESPONSE},
)
async def create_task_dependency_command(
    body: TaskDependencyCommandRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    relationship, revision, affected_ids, insights_delta = (
        await task_relationship_service.create_dependency_command(db, body)
    )
    await db.commit()
    await db.refresh(relationship)
    await notify_module_data_changed("todos")
    return TaskDependencyCommandResponse(
        relationship=relationship,
        dependent_task_id=body.dependent_task_id,
        prerequisite_task_id=body.prerequisite_task_id,
        base_graph_revision=body.expected_graph_revision,
        graph_revision=revision,
        affected_task_ids=affected_ids,
        insights_delta=insights_delta,
    )


@router.patch(
    "/{relationship_id}",
    response_model=TaskRelationshipResponse,
    responses={
        **_VALIDATION_RESPONSE,
        **_NOT_FOUND_RESPONSE,
        **_CONFLICT_RESPONSE,
    },
)
async def update_task_relationship(
    relationship_id: str,
    body: TaskRelationshipUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    relationship = await task_relationship_service.update_relationship(
        db,
        relationship_id,
        body,
    )
    await db.commit()
    await db.refresh(relationship)
    await notify_module_data_changed("todos")
    return relationship


@router.delete(
    "/{relationship_id}",
    status_code=204,
    responses=_NOT_FOUND_RESPONSE,
)
async def delete_task_relationship(
    relationship_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    await task_relationship_service.delete_relationship(db, relationship_id)
    await db.commit()
    await notify_module_data_changed("todos")
    return Response(status_code=204)
