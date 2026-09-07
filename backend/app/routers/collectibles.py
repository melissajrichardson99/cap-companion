from fastapi import APIRouter, Depends, HTTPException

from app.device_session import get_or_create_session
from app.errors import ConflictError, NotFoundError
from app.guest_auth import get_optional_guest
from app.models import CollectibleCard, CollectibleCatalogEntry, DeviceSession, Guest, PurchaseCollectibleRequest
from app.services import collectibles as collectibles_service

router = APIRouter(prefix="/collectibles", tags=["collectibles"])


@router.get("/catalog", response_model=list[CollectibleCatalogEntry])
def get_catalog() -> list[CollectibleCatalogEntry]:
    return collectibles_service.get_catalog()


@router.get("", response_model=list[CollectibleCard])
def list_cards(
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> list[CollectibleCard]:
    return collectibles_service.list_cards(session.id, guest.id if guest else None)


@router.post("/purchase", response_model=CollectibleCard)
def purchase(
    body: PurchaseCollectibleRequest,
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> CollectibleCard:
    try:
        return collectibles_service.purchase(body.animal_slug, body.guest_name, session.id, guest.id if guest else None)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
