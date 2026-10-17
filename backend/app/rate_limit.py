"""Minimal in-process rate limiting for guest auth endpoints (POST
/account/login and POST /account/password-reset/request) -- this project has
no existing rate-limiting infrastructure, so this is deliberately simple: a
fixed-window counter in a module-level dict, keyed by caller-supplied
identifier (normalized email).

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
import time
from collections import defaultdict

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
