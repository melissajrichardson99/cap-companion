from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.errors import NotFoundError
from app.models import Puzzle, PuzzleAttempt, RecordAttemptRequest
from app.services import puzzles as puzzles_service

router = APIRouter(prefix="/puzzles", tags=["puzzles"])


@router.get("", response_model=list[Puzzle])
def list_puzzles() -> list[Puzzle]:
    return puzzles_service.list_puzzles()


@router.post("/challenges/{challenge_id}/attempts", response_model=PuzzleAttempt)
def record_attempt(challenge_id: UUID, body: RecordAttemptRequest) -> PuzzleAttempt:
    try:
        return puzzles_service.record_attempt(challenge_id, body.elapsed_seconds, body.hints_used)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
