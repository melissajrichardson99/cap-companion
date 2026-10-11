from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.device_session import get_or_create_session
from app.errors import ConflictError, NotFoundError, ValidationError
from app.models import (
    CreateSessionRequest,
    DeviceSession,
    RecordHoleScoreRequest,
    RecordScoreEntryRequest,
    ScoreSheetSession,
    ScoringGame,
)
from app.services import scoring_sheet as scoring_sheet_service

router = APIRouter(prefix="/scoring", tags=["scoring"])


@router.get("/games", response_model=list[ScoringGame])
def list_games() -> list[ScoringGame]:
    return scoring_sheet_service.list_games()


@router.get("/games/{game_id}/active-session", response_model=ScoreSheetSession | None)
def get_active_session(
    game_id: UUID, device_session: DeviceSession = Depends(get_or_create_session)
) -> ScoreSheetSession | None:
    """This device's unfinished round of the game (null if none) -- lets a
    sheet resume after a reload, a phone lock or an app switch."""
    try:
        return scoring_sheet_service.get_active_session(game_id, device_session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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


@router.put("/sessions/{session_id}/holes", response_model=ScoreSheetSession)
def record_hole_score(
    session_id: UUID, body: RecordHoleScoreRequest, device_session: DeviceSession = Depends(get_or_create_session)
) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.record_hole_score(
            session_id, body.player_name, body.hole_number, body.strokes, device_session.id
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/sessions/{session_id}", status_code=204)
def abandon_session(session_id: UUID, device_session: DeviceSession = Depends(get_or_create_session)) -> None:
    try:
        scoring_sheet_service.abandon_session(session_id, device_session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
