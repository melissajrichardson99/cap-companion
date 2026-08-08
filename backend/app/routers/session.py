from fastapi import APIRouter

from app.models import ResetSessionResult
from app.services import session_reset

router = APIRouter(prefix="/session", tags=["session"])


@router.post("/reset", response_model=ResetSessionResult)
def reset_session() -> ResetSessionResult:
    return session_reset.reset_session()
