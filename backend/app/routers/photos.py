from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.device_session import get_or_create_session
from app.errors import ConflictError, NotFoundError, ValidationError
from app.models import DeviceSession, PhotoSubmission
from app.rate_limit import FAVORITE_PHOTO_UPLOAD, PHOTO_VOTE, device_rate_limit
from app.services import photos as photos_service
from app.staff_auth import require_staff
from app.uploads import GUEST_MAX_EDGE, LimitedUploadRoute, read_image_upload

router = APIRouter(prefix="/photos", tags=["photos"], route_class=LimitedUploadRoute)


@router.post("/submit", response_model=PhotoSubmission, dependencies=[Depends(device_rate_limit(FAVORITE_PHOTO_UPLOAD))])
async def submit(
    file: UploadFile = File(...),
    guest_label: str | None = Form(default=None),
    email: str | None = Form(default=None),
) -> PhotoSubmission:
    image = await read_image_upload(file, GUEST_MAX_EDGE)
    try:
        return photos_service.submit_photo(guest_label, email, image)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/pending", response_model=list[PhotoSubmission], dependencies=[Depends(require_staff)])
def list_pending() -> list[PhotoSubmission]:
    return photos_service.list_pending()


@router.get("/gallery", response_model=list[PhotoSubmission])
def gallery(session: DeviceSession = Depends(get_or_create_session)) -> list[PhotoSubmission]:
    return photos_service.list_gallery(session.id)


@router.get("/shortlisted", response_model=list[PhotoSubmission], dependencies=[Depends(require_staff)])
def list_shortlisted() -> list[PhotoSubmission]:
    # Staff-facing view of the same rows /gallery serves guests -- reuses
    # list_gallery so vote counts stay computed the same way in both places.
    # include_email=True is what's different here: this is the one
    # list_gallery call sitting behind require_staff, so it's the only one
    # allowed to surface email on shortlisted rows.
    return photos_service.list_gallery(None, include_email=True)


@router.get("/of-the-day", response_model=PhotoSubmission | None)
def of_the_day() -> PhotoSubmission | None:
    return photos_service.get_photo_of_the_day()


@router.post("/{submission_id}/shortlist", response_model=PhotoSubmission, dependencies=[Depends(require_staff)])
def shortlist(submission_id: UUID) -> PhotoSubmission:
    try:
        return photos_service.shortlist(submission_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{submission_id}/reject", response_model=PhotoSubmission, dependencies=[Depends(require_staff)])
def reject(submission_id: UUID) -> PhotoSubmission:
    try:
        return photos_service.reject(submission_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/shortlisted", dependencies=[Depends(require_staff)])
def clear_shortlisted() -> dict[str, int]:
    # Declared ahead of DELETE /{submission_id} below -- Starlette matches
    # routes in registration order, and a path literal here would otherwise
    # never be reached (every request would match /{submission_id} first,
    # with "shortlisted" parsed as a bogus submission_id).
    return {"deleted": photos_service.delete_all_shortlisted()}


@router.delete("/{submission_id}", status_code=204, dependencies=[Depends(require_staff)])
def delete(submission_id: UUID) -> None:
    try:
        photos_service.delete_submission(submission_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{submission_id}/vote", response_model=PhotoSubmission, dependencies=[Depends(device_rate_limit(PHOTO_VOTE))])
def cast_vote(submission_id: UUID, session: DeviceSession = Depends(get_or_create_session)) -> PhotoSubmission:
    try:
        return photos_service.vote(submission_id, session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
