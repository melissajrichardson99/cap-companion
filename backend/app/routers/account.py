"""Guest account endpoints (Guest Accounts Phase 0 -- foundational plumbing
only). Entirely additive: app/routers/device_session.py's anonymous
per-device sessions keep working completely unchanged whether or not a guest
is also logged in via these.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException

from app.device_session import get_or_create_session
from app.errors import ConflictError, ValidationError
from app.guest_auth import get_current_guest
from app.models import (
    BingoMapStartFreshResult,
    DeviceSession,
    GenericMessageResponse,
    Guest,
    GuestAuthResult,
    GuestBingoMapStatus,
    GuestLoginRequest,
    GuestSignupRequest,
    PassportSession,
    PasswordResetConfirmRequest,
    PasswordResetRequestRequest,
)
from app.rate_limit import check_rate_limit, record_attempt
from app.services import guest_accounts, map_bingo
from app.services import passport as passport_service

router = APIRouter(prefix="/account", tags=["guest-accounts"])

RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later."


@router.post("/signup", response_model=GuestAuthResult)
def signup(body: GuestSignupRequest, session: DeviceSession = Depends(get_or_create_session)) -> GuestAuthResult:
    # Guest Accounts Phase 5 security review: signup had no rate limiting at
    # all (unlike login/password-reset/request) -- nothing stopped scripted
    # spam account creation against this endpoint. Keyed the same way as
    # login/reset (normalized email) and, unlike login, recorded on every
    # call regardless of outcome -- each signup attempt (even one that 409s
    # on a duplicate email) is itself the resource being abused here, not
    # just failed credential guesses.
    rate_key = f"signup:{body.email.strip().lower()}"
    if not check_rate_limit(rate_key):
        raise HTTPException(status_code=429, detail=RATE_LIMITED_MESSAGE)
    record_attempt(rate_key)
    try:
        return guest_accounts.signup(body.email, body.password, session.id)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/login", response_model=GuestAuthResult)
def login(body: GuestLoginRequest, session: DeviceSession = Depends(get_or_create_session)) -> GuestAuthResult:
    rate_key = f"login:{body.email.strip().lower()}"
    if not check_rate_limit(rate_key):
        raise HTTPException(status_code=429, detail=RATE_LIMITED_MESSAGE)
    try:
        return guest_accounts.login(body.email, body.password, session.id)
    except ValidationError as exc:
        record_attempt(rate_key)
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/logout", response_model=GenericMessageResponse)
def logout(x_guest_auth: str = Header(...)) -> GenericMessageResponse:
    guest_accounts.logout(x_guest_auth)
    return GenericMessageResponse(message="Logged out")


@router.post("/password-reset/request", response_model=GenericMessageResponse)
def request_password_reset(body: PasswordResetRequestRequest) -> GenericMessageResponse:
    rate_key = f"reset:{body.email.strip().lower()}"
    # Rate-limited or not, the response is byte-for-byte identical either
    # way -- only whether the email actually gets sent changes -- so this
    # can't be used to distinguish "rate limited" from "account doesn't
    # exist" (enumeration prevention holds even under the rate limiter).
    if check_rate_limit(rate_key):
        record_attempt(rate_key)
        guest_accounts.request_password_reset(body.email)
    return GenericMessageResponse(message=guest_accounts.GENERIC_RESET_REQUESTED_MESSAGE)


@router.post("/password-reset/confirm", response_model=GenericMessageResponse)
def confirm_password_reset(body: PasswordResetConfirmRequest) -> GenericMessageResponse:
    try:
        guest_accounts.confirm_password_reset(body.token, body.new_password)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GenericMessageResponse(message="Password updated. Please log in again.")


@router.get("/whoami", response_model=Guest)
def whoami(guest: Guest = Depends(get_current_guest)) -> Guest:
    return guest


@router.get("/bingo-map/status", response_model=GuestBingoMapStatus)
def bingo_map_status(guest: Guest = Depends(get_current_guest)) -> GuestBingoMapStatus:
    # Guest Accounts Phase 3 -- called right after login so the frontend can
    # decide whether the "Welcome back" continue-or-start-fresh prompt should
    # appear at all (only when has_progress is true).
    return map_bingo.get_guest_bingo_map_status(guest.id)


@router.post("/bingo-map/start-fresh", response_model=BingoMapStartFreshResult)
def bingo_map_start_fresh(guest: Guest = Depends(get_current_guest)) -> BingoMapStartFreshResult:
    # Guest Accounts Phase 3 -- the one deliberate, guest-initiated wipe of
    # Bingo/Map progress across every device linked to this account. Never
    # triggered automatically and never bundled into Reset Session.
    return map_bingo.start_fresh_bingo_map(guest.id)


@router.get("/passports", response_model=list[PassportSession])
def list_passports(guest: Guest = Depends(get_current_guest)) -> list[PassportSession]:
    # Guest Accounts Phase 4 -- every passport ever generated for this guest,
    # across every device/visit, newest first. Guest-only (unlike Coins'
    # get_optional_guest fork): an anonymous session has no guest_id for any
    # passport to be tagged with, so there's nothing here to return.
    return passport_service.list_guest_passports(guest.id)
