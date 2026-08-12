from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.errors import ConflictError, NotFoundError
from app.models import CreateStaffRequestRequest, StaffRequest
from app.services import staff_requests as staff_requests_service
from app.staff_auth import require_staff

router = APIRouter(prefix="/staff-requests", tags=["staff-requests"])


@router.post("", response_model=StaffRequest)
def create_request(body: CreateStaffRequestRequest) -> StaffRequest:
    return staff_requests_service.create_request(body.type, body.location_node_id)


@router.get("", response_model=list[StaffRequest], dependencies=[Depends(require_staff)])
def list_requests(include_resolved: bool = False) -> list[StaffRequest]:
    return staff_requests_service.list_requests(include_resolved)


@router.post("/{request_id}/acknowledge", response_model=StaffRequest, dependencies=[Depends(require_staff)])
def acknowledge(request_id: UUID) -> StaffRequest:
    try:
        return staff_requests_service.acknowledge_request(request_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{request_id}/resolve", response_model=StaffRequest, dependencies=[Depends(require_staff)])
def resolve(request_id: UUID) -> StaffRequest:
    try:
        return staff_requests_service.resolve_request(request_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
