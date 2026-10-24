"""The Inbox's own record: what it just filed, and taking a move back."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from schemas.inbox_routing import (
    InboxRoutingAcknowledgeResponse,
    InboxRoutingListResponse,
    InboxRoutingResponse,
)
from services.data_sources.project_candidates import (
    ProjectFolderCandidate,
    project_folder_candidates,
)
from services.planning import inbox_routing_service
from services.planning.inbox_settings import auto_organize_enabled
from ws.notifications import notify_module_data_changed

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/routings", response_model=InboxRoutingListResponse)
async def list_recent_routings(db: AsyncSession = Depends(get_db)):
    """Moves from the last 24 hours that the user has neither cleared nor undone."""
    return InboxRoutingListResponse(
        items=await inbox_routing_service.recent(db),
        auto_organize=await auto_organize_enabled(db),
    )


@router.post("/routings/acknowledge", response_model=InboxRoutingAcknowledgeResponse)
async def acknowledge_routings(db: AsyncSession = Depends(get_db)):
    count = await inbox_routing_service.acknowledge(db)
    await db.commit()
    await notify_module_data_changed("inbox_routings")
    return InboxRoutingAcknowledgeResponse(acknowledged=count)


@router.post("/routings/{routing_id}/undo", response_model=InboxRoutingResponse)
async def undo_routing(routing_id: str, db: AsyncSession = Depends(get_db)):
    """Put the item back exactly as it was before this move, under its old id."""
    routing = await inbox_routing_service.undo(db, routing_id)
    await db.commit()
    await db.refresh(routing)
    for module in ("todos", "notes", "events", "inbox_routings"):
        await notify_module_data_changed(module)
    return routing


@router.get("/project-candidates", response_model=list[ProjectFolderCandidate])
async def list_project_candidates(db: AsyncSession = Depends(get_db)):
    """Vault project folders (``01_Projects/*``, folders with a ``TODO.md``) that
    no project is named after yet, from the server's vault and shared devices."""
    return await project_folder_candidates(db)
