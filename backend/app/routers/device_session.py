"""Throwaway verification endpoint for Per-Device Sessions Phase 0.

Not a guest-facing feature -- exists to prove the get_or_create_session
round trip (header -> upsert -> resolved session) works before any real
feature depends on it in a later phase. Fine to remove, or keep as a
lightweight health-check, once that migration is underway.
"""

from fastapi import APIRouter, Depends

from app.device_session import get_or_create_session
from app.models import DeviceSession

router = APIRouter(prefix="/session", tags=["device-session"])


@router.get("/whoami", response_model=DeviceSession)
def whoami(session: DeviceSession = Depends(get_or_create_session)) -> DeviceSession:
    return session
