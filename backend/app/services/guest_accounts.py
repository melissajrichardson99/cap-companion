"""Guest account service layer (Guest Accounts Phase 0). See app/guest_auth.py
for password hashing/token helpers, constants, and the get_current_guest
dependency; see app/services/email.py for the password reset email itself.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.errors import ConflictError, ValidationError
from app.guest_auth import (
    RESET_TOKEN_TTL_HOURS,
    generate_token,
    hash_password,
    is_password_strong_enough,
    is_reset_token_valid,
    normalize_email,
    verify_password,
)
from app.models import Guest, GuestAuthResult
from app.services import email as email_service
from app.supabase_client import get_supabase_client

# Never reveals whether the credential failure was a bad email or a bad
# password -- account enumeration prevention, per the Phase 0 ticket.
GENERIC_LOGIN_ERROR = "Invalid email or password"

# Returned regardless of whether the account exists -- same enumeration
# prevention, applied to the password-reset flow.
GENERIC_RESET_REQUESTED_MESSAGE = "If an account exists for that email, a password reset link has been sent."

GENERIC_RESET_TOKEN_ERROR = "Invalid or expired reset token"

# Guest Accounts Phase 5 security review: device_sessions.guest_id must never
# be silently overwritten. Before this, _link_device_session unconditionally
# repointed the calling session at whichever guest just authenticated -- if
# the session was already linked to a DIFFERENT guest (e.g. that guest used
# the nav's plain "Log Out", which only deletes their guest_auth_tokens row
# and does not unlink device_sessions.guest_id -- see session_reset.py's
# docstring on why only Start Fresh/Reset Session ever does that), a second
# person logging in or signing up on the same device would immediately and
# silently detach the first guest's Coins/Collectibles/Bingo/Map lifetime
# history, since every lifetime read is a live join over "sessions currently
# linked to me". _reject_if_linked_to_a_different_guest below is the guard:
# re-authenticating as the SAME guest already linked to this session is still
# a harmless no-op relink, but authenticating as anyone else is rejected
# outright (no token issued, no row created/touched) until the guest resets
# the session -- a plain Log Out does NOT clear the path (see above); Reset
# Session is the only thing that mints a fresh, unlinked device session token
# (see deviceSession.ts's rotateDeviceSessionId).
ALREADY_LINKED_TO_ANOTHER_GUEST_ERROR = (
    "This device is already signed in to a different account. Use Reset Session to free it up -- "
    "a plain Log Out is not enough."
)

logger = logging.getLogger("app")


def _issue_token(client, guest_id: str) -> str:
    token = generate_token()
    now = datetime.now(timezone.utc).isoformat()
    client.table("guest_auth_tokens").insert(
        {"guest_id": guest_id, "token": token, "created_at": now, "last_active_at": now}
    ).execute()
    return token


def _reject_if_linked_to_a_different_guest(client, session_id: UUID, guest_id: str) -> None:
    """Raise ConflictError if the calling device session is already linked to
    a guest other than `guest_id` -- see ALREADY_LINKED_TO_ANOTHER_GUEST_ERROR
    above. A session linked to `guest_id` itself (re-authenticating as
    yourself) or not linked to anyone yet both pass silently."""
    rows = client.table("device_sessions").select("guest_id").eq("id", str(session_id)).execute().data
    current_guest_id = rows[0]["guest_id"] if rows else None
    if current_guest_id is not None and current_guest_id != guest_id:
        raise ConflictError(ALREADY_LINKED_TO_ANOTHER_GUEST_ERROR)


def _link_device_session(client, session_id: UUID, guest_id: str) -> None:
    """Guest Accounts Phase 1: the calling request's own device session
    (X-Device-Session) becomes this guest's from this moment on. Whatever was
    already earned/purchased on it this visit is immediately part of the
    guest's lifetime total -- Coins/Collectibles' lifetime read (app/services/
    coins.py's get_total, app/services/collectibles.py's list_cards) joins
    through device_sessions.guest_id, so linking is the entire "merge", no
    separate copy step needed. A device must be re-linked by logging in again
    on it -- see migration 036's header for why Reset Session doesn't clear
    this column back off a session it was set on.

    Guest Accounts Phase 4 (migration 038): unlike Coins/Collectibles/Bingo/
    Map, Family Passport history isn't read via a cross-session join -- a
    passport is tagged with guest_id directly at generation time (see
    app/services/passport.py's generate_passport), so a passport generated on
    this device earlier in the same visit, before this login/signup, needs an
    explicit one-time backfill here to retroactively join the guest's
    history. Only rows still unlinked (guest_id is null) are touched -- never
    overwrites a passport already tied to a (possibly different) guest."""
    client.table("device_sessions").update({"guest_id": guest_id}).eq("id", str(session_id)).execute()
    client.table("passport_sessions").update({"guest_id": guest_id}).eq("session_id", str(session_id)).is_(
        "guest_id", "null"
    ).execute()


def signup(email: str, password: str, session_id: UUID) -> GuestAuthResult:
    normalized = normalize_email(email)
    if not is_password_strong_enough(password):
        raise ValidationError("Password must be at least 8 characters long")

    client = get_supabase_client()
    # Signup is the one place confirming "this email exists" isn't a security
    # problem (the guest just typed it themselves) -- unlike login/reset.
    existing = client.table("guests").select("id").eq("email", normalized).execute().data
    if existing:
        raise ConflictError("An account with that email already exists")

    # Checked before creating the row: a brand new account is, by definition,
    # a different guest than whoever (if anyone) this device is already
    # linked to -- see _reject_if_linked_to_a_different_guest's docstring.
    # Deliberately after the email-uniqueness check above so a duplicate-email
    # signup attempt still gets that more specific error regardless of this
    # device's current link state.
    device_rows = client.table("device_sessions").select("guest_id").eq("id", str(session_id)).execute().data
    if device_rows and device_rows[0]["guest_id"] is not None:
        raise ConflictError(ALREADY_LINKED_TO_ANOTHER_GUEST_ERROR)

    now = datetime.now(timezone.utc).isoformat()
    row = (
        client.table("guests")
        .insert({"email": normalized, "password_hash": hash_password(password), "created_at": now, "updated_at": now})
        .execute()
        .data[0]
    )
    token = _issue_token(client, row["id"])
    _link_device_session(client, session_id, row["id"])
    return GuestAuthResult(token=token, guest=Guest(id=row["id"], email=row["email"], created_at=row["created_at"]))


def login(email: str, password: str, session_id: UUID) -> GuestAuthResult:
    normalized = normalize_email(email)
    client = get_supabase_client()
    rows = (
        client.table("guests")
        .select("id, email, password_hash, created_at")
        .eq("email", normalized)
        .execute()
        .data
    )
    # Same branch/error whether the email doesn't exist or the password is
    # wrong -- what must not leak is the *response*, not the timing (no
    # dummy-hash comparison here; not worth it for this POC's threat model).
    if not rows or not verify_password(password, rows[0]["password_hash"]):
        raise ValidationError(GENERIC_LOGIN_ERROR)

    guest_row = rows[0]
    # Checked only after credentials are confirmed valid -- a wrong-password
    # attempt must still get the generic ValidationError above, never this
    # more specific one (which would otherwise leak "a *different* account is
    # linked here" to someone who hasn't proven they own either).
    _reject_if_linked_to_a_different_guest(client, session_id, guest_row["id"])
    token = _issue_token(client, guest_row["id"])
    _link_device_session(client, session_id, guest_row["id"])
    return GuestAuthResult(
        token=token, guest=Guest(id=guest_row["id"], email=guest_row["email"], created_at=guest_row["created_at"])
    )


def logout(token: str) -> None:
    client = get_supabase_client()
    client.table("guest_auth_tokens").delete().eq("token", token).execute()


def request_password_reset(email: str) -> None:
    normalized = normalize_email(email)
    client = get_supabase_client()
    rows = client.table("guests").select("id, email").eq("email", normalized).execute().data
    if not rows:
        # Caller (the router) always returns GENERIC_RESET_REQUESTED_MESSAGE
        # regardless -- silently doing nothing here is what makes that true.
        return

    guest_id = rows[0]["id"]
    token = generate_token()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=RESET_TOKEN_TTL_HOURS)
    client.table("password_reset_tokens").insert(
        {"guest_id": guest_id, "token": token, "created_at": now.isoformat(), "expires_at": expires_at.isoformat()}
    ).execute()
    try:
        email_service.send_password_reset_email(rows[0]["email"], token)
    except Exception:
        # Letting this propagate would 500 only when the account exists (the
        # no-such-account branch above returns silently with no send
        # attempt) -- an observable status-code difference that would
        # re-open exactly the enumeration hole this endpoint exists to
        # close. Log it server-side and still return success to the caller;
        # the router's response is identical either way.
        logger.exception("Failed to send password reset email to guest_id=%s", guest_id)


def confirm_password_reset(token: str, new_password: str) -> None:
    if not is_password_strong_enough(new_password):
        raise ValidationError("Password must be at least 8 characters long")

    client = get_supabase_client()
    rows = (
        client.table("password_reset_tokens")
        .select("id, guest_id, expires_at, used_at")
        .eq("token", token)
        .execute()
        .data
    )
    if not rows:
        raise ValidationError(GENERIC_RESET_TOKEN_ERROR)

    reset_row = rows[0]
    expires_at = datetime.fromisoformat(reset_row["expires_at"])
    used_at = datetime.fromisoformat(reset_row["used_at"]) if reset_row["used_at"] else None
    if not is_reset_token_valid(expires_at, used_at):
        raise ValidationError(GENERIC_RESET_TOKEN_ERROR)

    now = datetime.now(timezone.utc).isoformat()
    client.table("guests").update({"password_hash": hash_password(new_password), "updated_at": now}).eq(
        "id", reset_row["guest_id"]
    ).execute()
    client.table("password_reset_tokens").update({"used_at": now}).eq("id", reset_row["id"]).execute()
    # Force re-login everywhere -- standard practice after a password change,
    # and explicitly required by the Phase 0 ticket.
    client.table("guest_auth_tokens").delete().eq("guest_id", reset_row["guest_id"]).execute()
