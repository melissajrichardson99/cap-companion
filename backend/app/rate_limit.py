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
