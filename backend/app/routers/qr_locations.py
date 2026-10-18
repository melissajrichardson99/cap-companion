from __future__ import annotations

import threading
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response

from app.device_session import get_or_create_session
from app.errors import NotFoundError
from app.models import DeviceSession, QrDestinationType, QrLocation, ScanEventRequest, SetQrLocationRequest
from app.rate_limit import SCAN_EVENT_LOG, device_limit_hit
from app.services import heatmap as heatmap_service
from app.services import qr_locations
from app.staff_auth import require_staff

router = APIRouter(tags=["qr-locations"])

# Absorbs double-fires of the *same* arrival (e.g. a remount, or a retry)
# from one device: a repeat of the same destination within this window is
# accepted but not logged. Separate scans further apart are each counted --
# this doesn't change what "raw count" means. Process-local is fine for the
# single uvicorn process this app runs as; it's a best-effort guard, not an
# accounting rule, and only ever holds in-memory session ids, never stored.
SCAN_DEBOUNCE_SECONDS = 5.0
_recent_scans: dict[tuple[str, str, str], float] = {}
_recent_scans_lock = threading.Lock()


def _is_duplicate(key: tuple[str, str, str]) -> bool:
    now = time.monotonic()
    with _recent_scans_lock:
        for k, seen_at in list(_recent_scans.items()):
            if now - seen_at >= SCAN_DEBOUNCE_SECONDS:
                del _recent_scans[k]
        if key in _recent_scans:
            return True
        _recent_scans[key] = now
        return False


@router.post("/scan-events", status_code=204)
def log_scan(
    body: ScanEventRequest,
    background_tasks: BackgroundTasks,
    session: DeviceSession = Depends(get_or_create_session),
) -> Response:
    """Records one anonymous QR-scan arrival for the Staff Visit Heatmap.
    Fire-and-forget from the guest's side: the destination is resolved (and
    an unknown one rejected with 404) here, but the insert itself runs after
    the response is sent. The device session is used only for the debounce
    above and the logging limit, and is never written to the event row.

    Over SCAN_EVENT_LOG (120/hour per device) the arrival is answered
    exactly as normal but not logged -- this is analytics only, and the
    scan itself (GET /scan/..., the deep-linked pages, Mark Visited, coins,
    Bingo/Map progress) never goes through here."""
    try:
        resolved = qr_locations.resolve_scan(body.type, body.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if resolved is not None:
        destination_type, destination_id, map_node_id = resolved
        if not _is_duplicate((str(session.id), destination_type.value, destination_id)) and (
            device_limit_hit(SCAN_EVENT_LOG, str(session.id)) is None
        ):
            background_tasks.add_task(
                heatmap_service.log_visit_event,
                heatmap_service.QR_SCAN_SOURCE_TYPE,
                map_node_id,
                destination_type.value,
                destination_id,
            )
    return Response(status_code=204)


@router.get("/staff/qr-locations", response_model=list[QrLocation], dependencies=[Depends(require_staff)])
def list_locations() -> list[QrLocation]:
    return qr_locations.list_locations()


@router.put(
    "/staff/qr-locations/{destination_type}/{destination_id}",
    response_model=QrLocation,
    dependencies=[Depends(require_staff)],
)
def set_location(destination_type: QrDestinationType, destination_id: str, body: SetQrLocationRequest) -> QrLocation:
    try:
        return qr_locations.set_location(destination_type, destination_id, body.map_node_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except qr_locations.InvalidDestinationTypeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

