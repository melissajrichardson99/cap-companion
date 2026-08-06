from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.errors import ConflictError, NotFoundError
from app.models import CreateSessionRequest, RecordScoreEntryRequest, ScoreSheetSession, ScoringGame
from app.services import scoring_sheet as scoring_sheet_service

router = APIRouter(prefix="/scoring", tags=["scoring"])


@router.get("/games", response_model=list[ScoringGame])
def list_games() -> list[ScoringGame]:
    return scoring_sheet_service.list_games()


@router.post("/sessions", response_model=ScoreSheetSession)
def create_session(body: CreateSessionRequest) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.create_session(body.game_id, body.players)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}", response_model=ScoreSheetSession)
def get_session(session_id: UUID) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.get_session(session_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/entries", response_model=ScoreSheetSession)
def record_entry(session_id: UUID, body: RecordScoreEntryRequest) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.record_entry(session_id, body.player_name, body.score_event_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/finish", response_model=ScoreSheetSession)
def finish_session(session_id: UUID) -> ScoreSheetSession:
    try:
        return scoring_sheet_service.finish_session(session_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
