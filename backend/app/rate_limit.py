"""Minimal in-process rate limiting, in three independent parts:

- guest auth endpoints (POST /account/login and POST
  /account/password-reset/request): a fixed-window counter in a
  module-level dict, keyed by caller-supplied identifier (normalized
  email) -- directly below;
- staff login failures per client IP (further down);
- public write endpoints per device session -- Contact Staff, guest photo
  uploads, photo votes, heatmap scan logging (at the end; has its own
  RATE_LIMITS_ENABLED kill switch).

Known limitations, flagged explicitly for the Phase 0 security review rather
than glossed over: state is per-process (resets on every deploy/restart) and
not shared across backend instances, so it only actually limits abuse if this
API runs as a single instance -- true today (Render free-tier single
service), but would need a shared store (e.g. Redis) before scaling out
horizontally or before this matters for anything beyond deterring casual
brute-forcing.
"""

from __future__ import annotations

import math
import os
import threading
import time
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request

from app.device_session import get_or_create_session

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60

_attempts: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(key: str) -> bool:
    """True if `key` is currently within the allowed rate, False if it should be blocked."""
    now = time.monotonic()
    window_start = now - WINDOW_SECONDS
    attempts = [t for t in _attempts[key] if t > window_start]
    _attempts[key] = attempts
    return len(attempts) < MAX_ATTEMPTS


def record_attempt(key: str) -> None:
    _attempts[key].append(time.monotonic())


def reset_all() -> None:
    """Test-only: clears all tracked attempts between test cases."""
    _attempts.clear()


# --- Staff login: failures per client IP -----------------------------------
#
# A separate, failure-only limiter for POST /staff/login (one shared staff
# password, so there's no account to key on -- the client IP is the only
# handle). Only wrong passwords count, and a correct one clears the slate,
# so a staff member who mistypes once or twice is never affected. Same
# single-instance caveat as everything above (and as app/reference_cache.py).

STAFF_LOGIN_MAX_FAILURES = 5
STAFF_LOGIN_WINDOW_SECONDS = 10 * 60
# Bounds memory if failures arrive from very many addresses: past this many
# tracked IPs, keys whose failures have all aged out are dropped.
_STAFF_LOGIN_PRUNE_AT = 10_000

_clock = time.monotonic
_staff_login_failures: dict[str, list[float]] = {}


def _recent_staff_failures(ip: str, now: float) -> list[float]:
    recent = [t for t in _staff_login_failures.get(ip, ()) if t > now - STAFF_LOGIN_WINDOW_SECONDS]
    if recent:
        _staff_login_failures[ip] = recent
    else:
        _staff_login_failures.pop(ip, None)
    return recent


def staff_login_retry_after(ip: str) -> int | None:
    """Seconds until `ip` may try again, or None if it isn't blocked."""
    now = _clock()
    recent = _recent_staff_failures(ip, now)
    if len(recent) < STAFF_LOGIN_MAX_FAILURES:
        return None
    # Sliding window: the oldest counted failure ageing out frees one try.
    return max(1, math.ceil(recent[-STAFF_LOGIN_MAX_FAILURES] + STAFF_LOGIN_WINDOW_SECONDS - now))


def record_staff_login_failure(ip: str) -> None:
    now = _clock()
    if len(_staff_login_failures) >= _STAFF_LOGIN_PRUNE_AT:
        for key in list(_staff_login_failures):
            _recent_staff_failures(key, now)
    _staff_login_failures.setdefault(ip, []).append(now)


def clear_staff_login_failures(ip: str) -> None:
    _staff_login_failures.pop(ip, None)


def reset_staff_login_failures() -> None:
    """Test-only."""
    _staff_login_failures.clear()


def client_ip(request) -> str:
    """The caller's IP for rate limiting.

    On Render, uvicorn's TCP peer is Render's proxy, and the client address
    arrives in X-Forwarded-For. Render appends to that header rather than
    replacing it, so a client can put anything it likes at the *front* --
    keying on the first entry would let an attacker dodge the limit by
    sending a fresh fake IP each try. The last entry is the one Render's
    proxy added itself (the address it saw connecting), which the client
    can't forge, so that's the one trusted. With no header (local dev,
    tests) it falls back to the TCP peer.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"


# --- Public write endpoints: per device session -----------------------------
#
# Contact Staff, guest photo uploads, photo votes and heatmap scan logging
# (DEPLOYMENT.md section 8). Keyed on the device session, NEVER on IP: a
# whole park's worth of guests can share one Wi-Fi address, and a per-IP
# limit would end up blocking real families. The limits sit far above what a
# family actually does in a visit, so they only ever stop scripts and
# runaway clients.
#
# Key: the device_sessions.id the request resolves to -- the same identity
# every other per-device feature uses. A request with no X-Device-Session
# header at all (never the app: api.ts always sends one; only a hand-made
# request) has no session to key on, so it shares one small bucket per IP
# for that endpoint. That's the only place an IP is used.
#
# Known limit: a device session is whatever token the client sends, so a
# script that invents a new token per request gets a new bucket each time
# (and creates a device_sessions row each time). Stopping that needs either
# a per-IP ceiling or issued tokens -- both deliberately not done here.
#
# Sliding window, in memory, one process -- the same single-instance
# assumption as everything else in this module and app/reference_cache.py.
# Memory is bounded: each key keeps at most max_requests timestamps, and
# past _DEVICE_LIMIT_MAX_KEYS keys the expired ones are dropped, then the
# least recently used. Kill switch: RATE_LIMITS_ENABLED=0 turns all of
# these off (read on every call); the staff login limiter above stays on.


@dataclass(frozen=True)
class DeviceLimit:
    name: str
    max_requests: int
    window_seconds: int
    # The shared per-IP bucket for requests with no device session.
    anonymous_max_requests: int
    # "{wait}" is filled with e.g. "12 minutes".
    message: str


CONTACT_STAFF = DeviceLimit(
    "contact-staff",
    5,
    60 * 60,
    2,
    "You've sent several help requests in a short time. Please wait {wait} before sending another, "
    "or find a staff member nearby.",
)
FAVORITE_PHOTO_UPLOAD = DeviceLimit(
    "favorite-photo-upload",
    10,
    60 * 60,
    3,
    "You've uploaded a lot of photos in a short time. Please wait {wait} and try again.",
)
PASSPORT_PHOTO_UPLOAD = DeviceLimit(
    "passport-photo-upload",
    10,
    60 * 60,
    3,
    "You've made a lot of passports in a short time. Please wait {wait} and try again.",
)
PHOTO_VOTE = DeviceLimit(
    "photo-vote",
    60,
    60 * 60,
    10,
    "That's a lot of votes in a short time. Please wait {wait} and try again.",
)
# Over this, scan arrivals are still answered normally but not logged
# (heatmap analytics only) -- see routers/qr_locations.py.
SCAN_EVENT_LOG = DeviceLimit("scan-event-log", 120, 60 * 60, 20, "")
_WINDOWS = {
    limit.name: limit.window_seconds
    for limit in (CONTACT_STAFF, FAVORITE_PHOTO_UPLOAD, PASSPORT_PHOTO_UPLOAD, PHOTO_VOTE, SCAN_EVENT_LOG)
}

RATE_LIMITS_ENABLED_ENV = "RATE_LIMITS_ENABLED"
_DEVICE_LIMIT_MAX_KEYS = 50_000

_device_hits: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
_device_lock = threading.Lock()


def device_limits_enabled() -> bool:
    return os.environ.get(RATE_LIMITS_ENABLED_ENV, "1").strip().lower() not in ("0", "false", "no", "off")


def _prune_device_hits(now: float) -> None:
    for key in list(_device_hits):
        hits = _device_hits[key]
        window = _WINDOWS.get(key[0], 0)
        while hits and hits[0] <= now - window:
            hits.popleft()
        if not hits:
            del _device_hits[key]
    while len(_device_hits) >= _DEVICE_LIMIT_MAX_KEYS:  # room for the key being added
        _device_hits.popitem(last=False)



def device_limit_hit(limit: DeviceLimit, key: str, *, anonymous: bool = False) -> int | None:
    """Counts one request against `key` (a device session id, or an IP
    when `anonymous`). Returns None if it's allowed, or the seconds until
    the next one would be; a refused request isn't counted, so the wait
    never grows while a client keeps retrying."""
    if not device_limits_enabled():
        return None
    allowed = limit.anonymous_max_requests if anonymous else limit.max_requests
    bucket = (limit.name, f"ip:{key}" if anonymous else f"session:{key}")
    now = _clock()
    with _device_lock:
        hits = _device_hits.get(bucket)
        if hits is None:
            if len(_device_hits) >= _DEVICE_LIMIT_MAX_KEYS:
                _prune_device_hits(now)
            hits = _device_hits[bucket] = deque(maxlen=max(allowed, 1))
        else:
            _device_hits.move_to_end(bucket)
        while hits and hits[0] <= now - limit.window_seconds:
            hits.popleft()
        if len(hits) >= allowed:
            # Sliding window: the oldest counted request ageing out frees one.
            return max(1, math.ceil(hits[0] + limit.window_seconds - now))
        hits.append(now)
        return None


def _wait_text(seconds: int) -> str:
    if seconds < 60:
        return "a minute"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'' if minutes == 1 else 's'}"


def too_many_requests(limit: DeviceLimit, retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail=limit.message.format(wait=_wait_text(retry_after)),
        headers={"Retry-After": str(retry_after)},
    )


def device_rate_limit(limit: DeviceLimit):
    """A route dependency enforcing `limit` with a 429 (+ Retry-After). It
    runs before the endpoint body, so a refused upload is never decoded."""

    def dependency(request: Request, x_device_session: str | None = Header(default=None)) -> None:
        if x_device_session is not None and x_device_session.strip():
            # Same resolution (and in-memory cache) as the route's own
            # get_or_create_session -- the route's call then costs nothing.
            key, anonymous = str(get_or_create_session(x_device_session).id), False
        else:
            key, anonymous = client_ip(request), True
        retry_after = device_limit_hit(limit, key, anonymous=anonymous)
        if retry_after is not None:
            raise too_many_requests(limit, retry_after)

    dependency.device_limit = limit  # lets tests find which routes carry which limit
    return dependency


def reset_device_limits() -> None:
    """Test-only."""
    with _device_lock:
        _device_hits.clear()
