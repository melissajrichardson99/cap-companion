from fastapi import APIRouter, HTTPException

from app.errors import ConflictError, NotFoundError
from app.models import CollectibleCard, CollectibleCatalogEntry, PurchaseCollectibleRequest
from app.services import collectibles as collectibles_service

router = APIRouter(prefix="/collectibles", tags=["collectibles"])


@router.get("/catalog", response_model=list[CollectibleCatalogEntry])
def get_catalog() -> list[CollectibleCatalogEntry]:
    return collectibles_service.get_catalog()


@router.get("", response_model=list[CollectibleCard])
def list_cards() -> list[CollectibleCard]:
    return collectibles_service.list_cards()


@router.post("/purchase", response_model=CollectibleCard)
def purchase(body: PurchaseCollectibleRequest) -> CollectibleCard:
    try:
        return collectibles_service.purchase(body.animal_slug, body.guest_name)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
