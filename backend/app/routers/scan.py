from fastapi import APIRouter, HTTPException, Response

from app.errors import NotFoundError
from app.models import ScanResult
from app.services import scan as scan_service
from app.services.qr import generate_qr_png

router = APIRouter(prefix="/scan", tags=["scan"])


@router.get("/{code}", response_model=ScanResult)
def resolve(code: str) -> ScanResult:
    try:
        return scan_service.resolve_code(code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{code}/qr.png")
def qr_image(code: str) -> Response:
    try:
        # Validates the code exists before generating a PNG for it, so staff
        # can't accidentally print signage for a typo'd/deleted code.
        scan_service.resolve_code(code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=generate_qr_png(code), media_type="image/png")
