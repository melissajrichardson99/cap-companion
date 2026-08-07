from fastapi import APIRouter

from app.models import CoinsSummary
from app.services import coins as coins_service

router = APIRouter(prefix="/coins", tags=["coins"])


@router.get("/summary", response_model=CoinsSummary)
def get_summary() -> CoinsSummary:
    return coins_service.get_summary()
