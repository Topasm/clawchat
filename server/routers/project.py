"""First-class Project endpoints."""

from auth.dependencies import get_current_user
from database import get_db
from exceptions import NotFoundError, ValidationError
from fastapi import APIRouter, Depends, Query
from models.execution_host import ExecutionHost, ProjectHostPath
from models.project import Project
from schemas.execution_host import (
    ProjectExecutionHostSelect,
    ProjectHostPathResponse,
    ProjectHostPathUpsert,
    ProjectWorkspaceResponse,
)
from schemas.project import (
    ProjectCreate,
    ProjectOverviewResponse,
    ProjectResponse,
    ProjectUpdate,
)
from services.agents import execution_host_service
from services.tasks import project_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed


router = APIRouter()


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await project_service.list_projects(
        db,
        include_archived=include_archived,
    )


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await project_service.create_project(db, **body.model_dump())
    await db.commit()
    await db.refresh(project)
    await notify_module_data_changed("projects")
    await notify_module_data_changed("todos")
    return await project_service.build_project_response(db, project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Delete a project; its tasks return to the Inbox rather than disappearing."""
    await project_service.delete_project(db, project_id)
    await db.commit()
    await notify_module_data_changed("projects")
    await notify_module_data_changed("todos")


@router.get("/{project_id}", response_model=ProjectOverviewResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id)
    return await project_service.build_project_overview(db, project)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await project_service.update_project(
        db,
        project_id,
        **body.model_dump(exclude_unset=True),
    )
    await db.commit()
    await db.refresh(project)
    await notify_module_data_changed("projects")
    await notify_module_data_changed("todos")
    return await project_service.build_project_response(db, project)


# --- where a project's work runs -----------------------------------------


async def _workspace_response(
    db: AsyncSession,
    project: Project,
) -> ProjectWorkspaceResponse:
    resolution = await execution_host_service.resolve_workspace(db, project)
    paths = await execution_host_service.list_host_paths(db, project.id)
    return ProjectWorkspaceResponse(
        host_id=resolution.host.id if resolution.host else None,
        host_label=resolution.host.label if resolution.host else None,
        path=resolution.path,
        is_available=resolution.is_available,
        is_offline=resolution.is_offline,
        is_unconfigured=resolution.is_unconfigured,
        paths=[
            ProjectHostPathResponse(host_id=row.host_id, path=row.path) for row in paths
        ],
    )


async def _require_project(db: AsyncSession, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    return project


@router.get("/{project_id}/workspace", response_model=ProjectWorkspaceResponse)
async def get_project_workspace(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Where this project's work runs, and whether that machine can take it."""
    return await _workspace_response(db, await _require_project(db, project_id))


@router.put("/{project_id}/workspace/paths", response_model=ProjectWorkspaceResponse)
async def set_project_host_path(
    project_id: str,
    body: ProjectHostPathUpsert,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Record where this project lives on one machine."""
    project = await _require_project(db, project_id)
    host = await db.get(ExecutionHost, body.host_id)
    if host is None:
        raise NotFoundError("Execution host not found")

    existing = (
        await db.execute(
            select(ProjectHostPath).where(
                ProjectHostPath.project_id == project.id,
                ProjectHostPath.host_id == host.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            ProjectHostPath(project_id=project.id, host_id=host.id, path=body.path.strip())
        )
    else:
        existing.path = body.path.strip()

    # First machine recorded becomes the one the work runs on; anything else
    # would leave the project configured but pinned nowhere.
    if not project.execution_host_id:
        project.execution_host_id = host.id
    if project.execution_host_id == host.id:
        # Keep the compatibility shadow aligned with the chosen host.
        project.execution_workspace_path = body.path.strip()

    await db.commit()
    await db.refresh(project)
    return await _workspace_response(db, project)


@router.delete("/{project_id}/workspace/paths/{host_id}", status_code=204)
async def delete_project_host_path(
    project_id: str,
    host_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await _require_project(db, project_id)
    await db.execute(
        ProjectHostPath.__table__.delete().where(
            ProjectHostPath.project_id == project.id,
            ProjectHostPath.host_id == host_id,
        )
    )
    if project.execution_host_id == host_id:
        project.execution_host_id = None
        project.execution_workspace_path = None
    await db.commit()


@router.put("/{project_id}/workspace/host", response_model=ProjectWorkspaceResponse)
async def set_project_execution_host(
    project_id: str,
    body: ProjectExecutionHostSelect,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Choose which machine this project's work runs on."""
    project = await _require_project(db, project_id)
    host = await db.get(ExecutionHost, body.host_id)
    if host is None:
        raise NotFoundError("Execution host not found")

    path = await execution_host_service.get_host_path(db, project.id, host.id)
    if not path:
        raise ValidationError(
            "Record this project's path on that host first.",
            details={"reason": "host_path_required"},
        )

    project.execution_host_id = host.id
    project.execution_workspace_path = path
    await db.commit()
    await db.refresh(project)
    return await _workspace_response(db, project)
