from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.errors import ConflictError, NotFoundError
from app.models import CreateVoteRequest, PhotoSubmission
from app.services import photos as photos_service

router = APIRouter(prefix="/photos", tags=["photos"])


@router.post("/submit", response_model=PhotoSubmission)
async def submit(file: UploadFile = File(...), guest_label: str | None = Form(default=None)) -> PhotoSubmission:
    content = await file.read()
    return photos_service.submit_photo(
        guest_label, file.filename or "photo.jpg", file.content_type or "application/octet-stream", content
    )


@router.get("/pending", response_model=list[PhotoSubmission])
def list_pending() -> list[PhotoSubmission]:
    return photos_service.list_pending()


@router.get("/gallery", response_model=list[PhotoSubmission])
def gallery(voter_session_id: str | None = None) -> list[PhotoSubmission]:
    return photos_service.list_gallery(voter_session_id)


@router.post("/{submission_id}/shortlist", response_model=PhotoSubmission)
def shortlist(submission_id: UUID) -> PhotoSubmission:
    try:
        return photos_service.shortlist(submission_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{submission_id}/reject", response_model=PhotoSubmission)
def reject(submission_id: UUID) -> PhotoSubmission:
    try:
        return photos_service.reject(submission_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{submission_id}/vote", response_model=PhotoSubmission)
def cast_vote(submission_id: UUID, body: CreateVoteRequest) -> PhotoSubmission:
    try:
        return photos_service.vote(submission_id, body.voter_session_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
