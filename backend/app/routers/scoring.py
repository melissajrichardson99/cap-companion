from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.device_session import get_or_create_session
from app.errors import ConflictError, NotFoundError
from app.models import CreateSessionRequest, DeviceSession, RecordScoreEntryRequest, ScoreSheetSession, ScoringGame
from app.services import scoring_sheet as scoring_sheet_service

router = APIRouter(prefix="/scoring", tags=["scoring"])


@router.get("/games", response_model=list[ScoringGame])
def list_games() -> list[ScoringGame]:
    return scoring_sheet_service.list_games()


@router.post("/sessions", response_model=ScoreSheetSession)
def create_session(
    body: CreateSessionRequest, device_session: DeviceSession = Depends(get_or_create_session)
) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.create_session(body.game_id, body.players, device_session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}", response_model=ScoreSheetSession)
def get_session(session_id: UUID, device_session: DeviceSession = Depends(get_or_create_session)) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.get_session(session_id, device_session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/entries", response_model=ScoreSheetSession)
def record_entry(
    session_id: UUID, body: RecordScoreEntryRequest, device_session: DeviceSession = Depends(get_or_create_session)
) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.record_entry(
            session_id, body.player_name, body.score_event_id, device_session.id
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/finish", response_model=ScoreSheetSession)
def finish_session(
    session_id: UUID, device_session: DeviceSession = Depends(get_or_create_session)
) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.finish_session(session_id, device_session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
