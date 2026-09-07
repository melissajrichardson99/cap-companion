from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.device_session import get_or_create_session
from app.errors import NotFoundError
from app.guest_auth import get_optional_guest
from app.models import BingoCard, BingoCardSummary, DeviceSession, Guest, Minigame, TileCompletionResult
from app.services import map_bingo

router = APIRouter(prefix="/bingo", tags=["bingo"])


@router.get("/cards", response_model=list[BingoCardSummary])
def list_cards() -> list[BingoCardSummary]:
    return map_bingo.list_bingo_cards()


@router.get("/minigames", response_model=list[Minigame])
def list_minigames() -> list[Minigame]:
    # Lives under /bingo since map_bingo.py already owns the minigames table
    # (the draw pool). Also used by the Scavenger Hunt frontend to resolve a
    # character's minigame_slug to the full Minigame row.
    return map_bingo.list_minigames()


@router.get("/card/{card_id}", response_model=BingoCard)
def get_card(
    card_id: UUID,
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> BingoCard:
    try:
        return map_bingo.get_bingo_card(card_id, session.id, guest.id if guest else None)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/tiles/{tile_id}/complete", response_model=TileCompletionResult)
def complete_tile(
    tile_id: UUID,
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> TileCompletionResult:
    try:
        return map_bingo.complete_tile(tile_id, session.id, guest.id if guest else None)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
