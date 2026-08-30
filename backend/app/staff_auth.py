"""Shared-password staff auth (no per-staff accounts -- see CLAUDE.md scope).

Stateless signed session tokens via itsdangerous: no staff_sessions table, no
DB round-trip to validate a request. STAFF_PASSWORD/STAFF_SESSION_SECRET must
be set in the environment (see .env.example) before login works.
"""

import hmac
import os
from urllib.parse import unquote

from fastapi import Header, HTTPException
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

STAFF_PASSWORD = os.environ.get("STAFF_PASSWORD")
STAFF_SESSION_SECRET = os.environ.get("STAFF_SESSION_SECRET")

SESSION_MAX_AGE_SECONDS = 60 * 60 * 12  # 12 hours

_serializer: URLSafeTimedSerializer | None = None


def _get_serializer() -> URLSafeTimedSerializer:
    global _serializer
    if not STAFF_SESSION_SECRET:
        raise RuntimeError("STAFF_SESSION_SECRET must be set in the environment for staff auth to work.")
    if _serializer is None:
        _serializer = URLSafeTimedSerializer(STAFF_SESSION_SECRET, salt="cap-staff-session")
    return _serializer


def check_password(password: str) -> bool:
    if not STAFF_PASSWORD:
        raise RuntimeError("STAFF_PASSWORD must be set in the environment for staff auth to work.")
    return hmac.compare_digest(password, STAFF_PASSWORD)


def create_staff_token() -> str:
    return _get_serializer().dumps("staff")


def verify_staff_token(token: str) -> bool:
    try:
        _get_serializer().loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return True


def require_staff(authorization: str | None = Header(default=None)) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing staff session token")
    token = authorization.removeprefix("Bearer ")
    if not verify_staff_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired staff session token")


# Shared "who is this staff member" dependency (lightweight -- self-reported
# display name, not a second auth mechanism; see frontend/src/staffName.ts).
# Any staff-only endpoint can add `staff_name: str | None = Depends(get_staff_name)`
# to attribute an action, with no frontend changes needed -- api.ts's
# staffRequest() already sends this header on every staff-authenticated call.
# Optional everywhere: a staff member who hasn't set a name yet can still act,
# just without attribution.
def get_staff_name(x_staff_name: str | None = Header(default=None, alias="X-Staff-Name")) -> str | None:
    if not x_staff_name:
        return None
    trimmed = unquote(x_staff_name).strip()
    return trimmed or None
