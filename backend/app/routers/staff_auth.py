from fastapi import APIRouter, Depends, HTTPException

from app.models import StaffLoginRequest, StaffLoginResponse
from app.staff_auth import check_password, create_staff_token, require_staff

router = APIRouter(prefix="/staff", tags=["staff-auth"])


@router.post("/login", response_model=StaffLoginResponse)
def login(body: StaffLoginRequest) -> StaffLoginResponse:
    if not check_password(body.password):
        raise HTTPException(status_code=401, detail="Incorrect password")
    return StaffLoginResponse(token=create_staff_token())


@router.get("/session", dependencies=[Depends(require_staff)])
def check_session() -> dict[str, bool]:
    return {"ok": True}
