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

import threading
from collections import OrderedDict
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Header, HTTPException

from app.models import DeviceSession
from app.supabase_client import get_supabase_client


# last_active_at only has to be accurate to well within session cleanup's
# 14-day inactivity threshold (app/services/session_cleanup.py), so it's
# refreshed at most once per this interval per token instead of on every
# request. In between, the session resolved by the last upsert -- including
# the last_active_at that upsert wrote -- is reused from memory with no
# Supabase call at all (every session-scoped request used to cost one).
# Safe because nothing ever deletes a session that was active this recently
# (cleanup only removes ones idle for 14 days), and DeviceSession carries
# no field that changes in between (guest_id linking isn't part of it).
LAST_ACTIVE_REFRESH_INTERVAL = timedelta(minutes=5)
# Bounds the in-memory map; least-recently-used tokens fall out first and
# simply get a fresh upsert next time.
_RECENT_SESSIONS_MAX = 20_000

_recent_sessions: OrderedDict[str, DeviceSession] = OrderedDict()
_recent_sessions_lock = threading.Lock()
# Single-flight: the upsert currently running for a token, if any. A new
# device's first page load fires its API calls in parallel, and every one of
# them used to miss the cache and upsert on its own (about 6 for one load).
# Now the first request runs the upsert and the rest wait on its Future.
# Entries are removed as soon as the upsert finishes, success or failure, so
# a failed upsert is retried by the next request rather than cached.
_inflight: dict[str, Future[DeviceSession]] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_or_create_session(x_device_session: str = Header(...)) -> DeviceSession:
    if not x_device_session.strip():
        raise HTTPException(status_code=400, detail="X-Device-Session header must not be blank")

    now = _now()
    with _recent_sessions_lock:
        cached = _recent_sessions.get(x_device_session)
        if cached is not None and now - cached.last_active_at < LAST_ACTIVE_REFRESH_INTERVAL:
            _recent_sessions.move_to_end(x_device_session)
            return cached
        inflight = _inflight.get(x_device_session)
        if inflight is None:
            inflight = _inflight[x_device_session] = Future()
            leader = True
        else:
            leader = False

    if not leader:
        # Re-raises the leader's exception if its upsert failed. The lock is
        # not held while waiting, only while touching the two dicts.
        return inflight.result()

    try:
        session = _upsert_session(x_device_session, now)
    except BaseException as exc:
        with _recent_sessions_lock:
            del _inflight[x_device_session]
        inflight.set_exception(exc)
        raise
    with _recent_sessions_lock:
        _recent_sessions[x_device_session] = session
        _recent_sessions.move_to_end(x_device_session)
        while len(_recent_sessions) > _RECENT_SESSIONS_MAX:
            _recent_sessions.popitem(last=False)
        del _inflight[x_device_session]
    inflight.set_result(session)
    return session


def _upsert_session(device_token: str, now: datetime) -> DeviceSession:
    """Creates the session on first use and (re)stamps last_active_at."""
    client = get_supabase_client()
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
            {"device_token": device_token, "last_active_at": now.isoformat()},
            on_conflict="device_token",
            default_to_null=False,
        )
        .execute()
        .data[0]
    )
    return DeviceSession(id=row["id"], created_at=row["created_at"], last_active_at=row["last_active_at"])


def list_guest_session_ids(guest_id: UUID) -> list[str]:
    """Every device_sessions.id ever linked to `guest_id` (Guest Accounts
    Phase 1, migration 036) -- the join Coins/Collectibles' lifetime totals
    are computed through (see app/services/coins.py's get_total and
    app/services/collectibles.py's list_cards/purchase). A guest with no
    linked sessions yet (shouldn't happen in practice -- signup/login always
    link the calling session in the same request) returns an empty list
    rather than erroring."""
    client = get_supabase_client()
    rows = client.table("device_sessions").select("id").eq("guest_id", str(guest_id)).execute().data
    return [row["id"] for row in rows]
