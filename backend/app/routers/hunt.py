from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.errors import NotFoundError
from app.models import HuntCharacter
from app.services import hunt as hunt_service

router = APIRouter(prefix="/hunt", tags=["hunt"])


@router.get("/characters", response_model=list[HuntCharacter])
def list_characters() -> list[HuntCharacter]:
    return hunt_service.list_characters()


@router.post("/challenges/{challenge_id}/complete", response_model=HuntCharacter)
def complete_challenge(challenge_id: UUID) -> HuntCharacter:
    try:
        return hunt_service.complete_challenge(challenge_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
