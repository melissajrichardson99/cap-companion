from fastapi import APIRouter, Depends, HTTPException, Response

from app.device_session import get_or_create_session
from app.errors import ConflictError, NotFoundError
from app.models import DeviceSession, ManualEntryResolution, ScanResult
from app.services import scan as scan_service
from app.services.qr import generate_qr_png

router = APIRouter(prefix="/scan", tags=["scan"])


@router.get("/{code}", response_model=ScanResult)
def resolve(code: str, session: DeviceSession = Depends(get_or_create_session)) -> ScanResult:
    try:
        return scan_service.resolve_code(code, session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ScanEntryModal's manual-entry field is one shared input across all four
# QR-routable destination types (Hunt/Encyclopedia codes, Scoring games,
# Puzzle challenges, Our Animals) -- no session dependency here since this
# only resolves *which type* matched, not any per-guest state (unlocking a
# Hunt character still happens via GET /scan/{code} above, same as a direct
# deep link).
@router.get("/lookup/{text}", response_model=ManualEntryResolution)
def lookup(text: str) -> ManualEntryResolution:
    try:
        return scan_service.resolve_manual_entry(text)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{code}/qr.png")
def qr_image(code: str) -> Response:
    try:
        # Validates the code exists before generating a PNG for it, so staff
        # can't accidentally print signage for a typo'd/deleted code. No
        # device session to resolve here (staff QR-generation, not a guest
        # read) -- session_id=None returns a character with no progress
        # resolved, which this call ignores anyway.
        scan_service.resolve_code(code, session_id=None)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=generate_qr_png(code), media_type="image/png")
