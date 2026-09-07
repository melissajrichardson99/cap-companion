from fastapi import APIRouter, Depends

from app.device_session import get_or_create_session
from app.guest_auth import get_optional_guest
from app.models import CoinsSummary, DeviceSession, Guest
from app.services import coins as coins_service

router = APIRouter(prefix="/coins", tags=["coins"])


@router.get("/summary", response_model=CoinsSummary)
def get_summary(
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> CoinsSummary:
    return coins_service.get_summary(session.id, guest.id if guest else None)
