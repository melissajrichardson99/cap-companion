"""Guest account auth (Guest Accounts Phase 0 -- foundational plumbing only,
no real feature reads/writes guest-scoped data yet).

Distinct from app/device_session.py's anonymous per-device tokens (which keep
working entirely unchanged -- this is an additive, optional feature, not a
replacement) and app/staff_auth.py's shared-password staff sessions
(stateless, no DB, single shared credential). Guest auth tokens ARE stored
server-side (guest_auth_tokens) since -- unlike staff -- there's a real
"log out everywhere" requirement: a password change must invalidate every
other active session for that account, which a stateless signed token can't
do without a separate revocation list anyway.

get_current_guest is meant to be imported as a FastAPI dependency by any
future guest-account-scoped router, not just the throwaway GET /account/whoami
endpoint in app/routers/account.py.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Header, HTTPException

from app.models import Guest
from app.supabase_client import get_supabase_client

# Sliding expiration: refreshed on every authenticated request (see
# get_current_guest below); a token is invalid once unused for this long.
# Checked in-app rather than by a DB job -- no cron/pg_cron in this stack.
TOKEN_SLIDING_EXPIRY_DAYS = 90

# Password reset links are short-lived -- see app/services/guest_accounts.py's
# request_password_reset, which is the only place this is used to compute
# expires_at.
RESET_TOKEN_TTL_HOURS = 1

# Kept reasonable for a low-stakes hobby app, not maximally strict -- see the
# Guest Accounts Phase 0 ticket.
MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed/foreign hash -- treat as "doesn't match" rather than
        # raising, same as a genuine mismatch.
        return False


def generate_token() -> str:
    # secrets.token_urlsafe is a CSPRNG (os.urandom under the hood) -- never
    # uuid4/random for anything that gates access, per the Phase 0 security
    # review's explicit requirement.
    return secrets.token_urlsafe(32)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_password_strong_enough(password: str) -> bool:
    return len(password) >= MIN_PASSWORD_LENGTH


def is_reset_token_valid(expires_at: datetime, used_at: datetime | None, *, now: datetime | None = None) -> bool:
    if used_at is not None:
        return False
    now = now or datetime.now(timezone.utc)
    return now < expires_at


def is_auth_token_expired(last_active_at: datetime, *, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return now - last_active_at > timedelta(days=TOKEN_SLIDING_EXPIRY_DAYS)


def get_current_guest(x_guest_auth: str = Header(...)) -> Guest:
    if not x_guest_auth.strip():
        raise HTTPException(status_code=401, detail="X-Guest-Auth header must not be blank")

    client = get_supabase_client()
    token_rows = (
        client.table("guest_auth_tokens")
        .select("id, guest_id, last_active_at")
        .eq("token", x_guest_auth)
        .execute()
        .data
    )
    if not token_rows:
        raise HTTPException(status_code=401, detail="Invalid or expired guest session")
    token_row = token_rows[0]

    if is_auth_token_expired(datetime.fromisoformat(token_row["last_active_at"])):
        raise HTTPException(status_code=401, detail="Invalid or expired guest session")

    guest_rows = client.table("guests").select("id, email, created_at").eq("id", token_row["guest_id"]).execute().data
    if not guest_rows:
        raise HTTPException(status_code=401, detail="Invalid or expired guest session")

    now = datetime.now(timezone.utc).isoformat()
    client.table("guest_auth_tokens").update({"last_active_at": now}).eq("id", token_row["id"]).execute()

    guest_row = guest_rows[0]
    return Guest(id=guest_row["id"], email=guest_row["email"], created_at=guest_row["created_at"])


def get_optional_guest(x_guest_auth: str | None = Header(default=None)) -> Guest | None:
    """Guest Accounts Phase 1: for a router that should behave one way for a
    logged-in guest and another (not error) for an anonymous one -- e.g. the
    Coins/Collectibles routers, which need to know whether to scope a read to
    the calling session alone or to every session ever linked to a guest.
    Unlike get_current_guest, a missing header, a blank header, or a token
    that fails validation for any reason (expired, revoked, malformed) all
    just mean "anonymous" here -- never a 401. Only the account-specific
    endpoints from Phase 0 (GET /account/whoami, POST /account/logout) still
    use get_current_guest and actually require the header."""
    if not x_guest_auth or not x_guest_auth.strip():
        return None
    try:
        return get_current_guest(x_guest_auth)
    except HTTPException:
        return None
