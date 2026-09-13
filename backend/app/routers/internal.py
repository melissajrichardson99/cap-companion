"""Machine-to-machine internal endpoints -- not part of the guest- or
staff-facing surface (see app/internal_auth.py for the shared-secret gate).
"""

from fastapi import APIRouter, Depends

from app.internal_auth import require_internal_secret
from app.models import SessionCleanupResult
from app.services import session_cleanup

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal_secret)])


@router.post("/session-cleanup", response_model=SessionCleanupResult)
def run_session_cleanup() -> SessionCleanupResult:
    return session_cleanup.cleanup_abandoned_sessions()
