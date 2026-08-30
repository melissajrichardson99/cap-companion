from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.device_session import get_or_create_session
from app.errors import ConflictError, NotFoundError
from app.models import CreateStaffRequestRequest, DeviceSession, StaffRequest
from app.services import staff_requests as staff_requests_service
from app.staff_auth import get_staff_name, require_staff

router = APIRouter(prefix="/staff-requests", tags=["staff-requests"])


@router.post("", response_model=StaffRequest)
def create_request(
    body: CreateStaffRequestRequest, session: DeviceSession = Depends(get_or_create_session)
) -> StaffRequest:
    try:
        return staff_requests_service.create_request(
            session.id, body.type, body.location_node_id, body.name, body.description
        )
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/mine", response_model=StaffRequest | None)
def get_my_request(session: DeviceSession = Depends(get_or_create_session)) -> StaffRequest | None:
    return staff_requests_service.get_active_request(session.id)


@router.post("/mine/cancel", response_model=StaffRequest)
def cancel_my_request(session: DeviceSession = Depends(get_or_create_session)) -> StaffRequest:
    try:
        return staff_requests_service.cancel_active_request(session.id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("", response_model=list[StaffRequest], dependencies=[Depends(require_staff)])
def list_requests(include_closed: bool = False) -> list[StaffRequest]:
    return staff_requests_service.list_requests(include_closed)


@router.post("/{request_id}/acknowledge", response_model=StaffRequest, dependencies=[Depends(require_staff)])
def acknowledge(request_id: UUID, staff_name: str | None = Depends(get_staff_name)) -> StaffRequest:
    try:
        return staff_requests_service.acknowledge_request(request_id, staff_name)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{request_id}/resolve", response_model=StaffRequest, dependencies=[Depends(require_staff)])
def resolve(request_id: UUID, staff_name: str | None = Depends(get_staff_name)) -> StaffRequest:
    try:
        return staff_requests_service.resolve_request(request_id, staff_name)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
