import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.models import StaffLoginRequest, StaffLoginResponse
from app.rate_limit import (
    clear_staff_login_failures,
    client_ip,
    record_staff_login_failure,
    staff_login_retry_after,
)
from app.staff_auth import check_password, create_staff_token, require_staff

logger = logging.getLogger("app")

router = APIRouter(prefix="/staff", tags=["staff-auth"])


@router.post("/login", response_model=StaffLoginResponse)
def login(body: StaffLoginRequest, request: Request) -> StaffLoginResponse:
    ip = client_ip(request)
    # Checked before the password, so a locked-out caller can't keep
    # guessing (a correct password is refused too until the window passes).
    retry_after = staff_login_retry_after(ip)
    if retry_after is not None:
        minutes = (retry_after + 59) // 60
        raise HTTPException(
            status_code=429,
            detail=f"Too many incorrect password attempts. Please wait {minutes} minute"
            f"{'' if minutes == 1 else 's'} and try again.",
            headers={"Retry-After": str(retry_after)},
        )
    if not check_password(body.password):
        record_staff_login_failure(ip)
        if staff_login_retry_after(ip) is not None:
            logger.warning("Staff login locked out for client %s after repeated failures", ip)
        raise HTTPException(status_code=401, detail="Incorrect password")
    clear_staff_login_failures(ip)
    return StaffLoginResponse(token=create_staff_token())


@router.get("/session", dependencies=[Depends(require_staff)])
def check_session() -> dict[str, bool]:
    return {"ok": True}
