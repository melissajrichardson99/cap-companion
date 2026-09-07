"""Unit tests for app/rate_limit.py's fixed-window counter, the enforcement
behind /account/login and /account/password-reset/request's rate limiting
(Guest Accounts Phase 0 ticket calls this out for explicit verification, not
just "present in code")."""

import app.rate_limit as rate_limit
from app.rate_limit import MAX_ATTEMPTS, check_rate_limit, record_attempt


def setup_function():
    rate_limit.reset_all()


def test_allows_attempts_up_to_the_limit():
    key = "login:guest@example.com"
    for _ in range(MAX_ATTEMPTS):
        assert check_rate_limit(key) is True
        record_attempt(key)


def test_blocks_once_the_limit_is_exceeded():
    key = "login:guest@example.com"
    for _ in range(MAX_ATTEMPTS):
        record_attempt(key)
    assert check_rate_limit(key) is False


def test_different_keys_are_tracked_independently():
    for _ in range(MAX_ATTEMPTS):
        record_attempt("login:a@example.com")
    assert check_rate_limit("login:a@example.com") is False
    assert check_rate_limit("login:b@example.com") is True


def test_attempts_outside_the_window_do_not_count(monkeypatch):
    key = "login:guest@example.com"
    times = iter([0.0] * MAX_ATTEMPTS)
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: next(times, 0.0))
    for _ in range(MAX_ATTEMPTS):
        record_attempt(key)

    # Now well past WINDOW_SECONDS -- the old attempts should have aged out.
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: rate_limit.WINDOW_SECONDS + 1)
    assert check_rate_limit(key) is True
