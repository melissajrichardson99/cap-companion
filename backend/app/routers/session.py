from fastapi import APIRouter, Depends, Header

from app.device_session import get_or_create_session
from app.models import DeviceSession, ResetSessionResult
from app.services import session_reset

router = APIRouter(prefix="/session", tags=["session"])


@router.post("/reset", response_model=ResetSessionResult)
def reset_session(
    session: DeviceSession = Depends(get_or_create_session),
    x_guest_auth: str | None = Header(default=None),
) -> ResetSessionResult:
    return session_reset.reset_session(session.id, x_guest_auth)
