from fastapi import APIRouter, Depends

from app.device_session import get_or_create_session
from app.models import CoinsSummary, DeviceSession
from app.services import coins as coins_service

router = APIRouter(prefix="/coins", tags=["coins"])


@router.get("/summary", response_model=CoinsSummary)
def get_summary(session: DeviceSession = Depends(get_or_create_session)) -> CoinsSummary:
    return coins_service.get_summary(session.id)
