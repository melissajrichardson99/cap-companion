"""Per-device session resolution (Per-Device Sessions Phase 0 -- foundational
plumbing, no real feature reads/writes device_sessions yet).

Deliberately not a signed/issued token like app/staff_auth.py's staff
sessions: the frontend mints its own token client-side via
crypto.randomUUID() (see frontend/src/deviceSession.ts) and the backend just
upsert-on-first-use's whatever it's handed via the X-Device-Session header --
there's no "create session" endpoint and no invalid/missing-token case to
reject, only a missing *header*, which is a caller bug (every request goes
through api.ts's shared request()/staffRequest() helpers, which always
attach it).

get_or_create_session is meant to be imported as a FastAPI dependency by
every future per-session router, not just the throwaway /session/whoami
endpoint in app/routers/device_session.py.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Header, HTTPException

from app.models import DeviceSession
from app.supabase_client import get_supabase_client


def get_or_create_session(x_device_session: str = Header(...)) -> DeviceSession:
    if not x_device_session.strip():
        raise HTTPException(status_code=400, detail="X-Device-Session header must not be blank")

    client = get_supabase_client()
    now = datetime.now(timezone.utc).isoformat()
    # Single atomic upsert (ON CONFLICT DO UPDATE) rather than select-then-
    # insert-or-update: two requests racing on the same brand-new token
    # (e.g. a page load firing several API calls in parallel before the
    # backend has seen the token even once) would otherwise both see "no
    # row" and both try to insert, and the second would hit the unique
    # constraint. default_to_null=False is required here -- postgrest-py
    # otherwise sends `Prefer: missing=null`, which would null out id/
    # created_at on insert instead of letting the column defaults apply.
    row = (
        client.table("device_sessions")
        .upsert(
            {"device_token": x_device_session, "last_active_at": now},
            on_conflict="device_token",
            default_to_null=False,
        )
        .execute()
        .data[0]
    )
    return DeviceSession(id=row["id"], created_at=row["created_at"], last_active_at=row["last_active_at"])
