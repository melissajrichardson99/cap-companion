from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.errors import NotFoundError
from app.models import Announcement, CreateAnnouncementRequest, UpdateAnnouncementRequest
from app.services import announcements as announcements_service
from app.staff_auth import require_staff

router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get("", response_model=list[Announcement])
def list_announcements() -> list[Announcement]:
    return announcements_service.list_announcements()


@router.post("", response_model=Announcement, dependencies=[Depends(require_staff)])
def create_announcement(body: CreateAnnouncementRequest) -> Announcement:
    return announcements_service.create_announcement(body.text)


@router.patch("/{announcement_id}", response_model=Announcement, dependencies=[Depends(require_staff)])
def update_announcement(announcement_id: UUID, body: UpdateAnnouncementRequest) -> Announcement:
    try:
        return announcements_service.update_announcement(announcement_id, body.text)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{announcement_id}", status_code=204, dependencies=[Depends(require_staff)])
def delete_announcement(announcement_id: UUID) -> None:
    try:
        announcements_service.delete_announcement(announcement_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
