from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.device_session import get_or_create_session
from app.errors import NotFoundError
from app.models import DeviceSession, HuntCharacter
from app.services import hunt as hunt_service

router = APIRouter(prefix="/hunt", tags=["hunt"])


@router.get("/characters", response_model=list[HuntCharacter])
def list_characters(session: DeviceSession = Depends(get_or_create_session)) -> list[HuntCharacter]:
    return hunt_service.list_characters(session.id)


@router.post("/challenges/{challenge_id}/complete", response_model=HuntCharacter)
def complete_challenge(
    challenge_id: UUID, session: DeviceSession = Depends(get_or_create_session)
) -> HuntCharacter:
    try:
        return hunt_service.complete_challenge(challenge_id, session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/characters/{character_id}/unlock", response_model=HuntCharacter)
def unlock_character(
    character_id: UUID, session: DeviceSession = Depends(get_or_create_session)
) -> HuntCharacter:
    try:
        return hunt_service.unlock_character(character_id, session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
