"""Unit tests for Guest Accounts Phase 0's pure/self-contained logic: password
hashing, token generation, reset-token single-use/expiry, and the sliding
auth-token expiry -- the parts of app/guest_auth.py that don't need a live
Supabase project to exercise. The DB round trip itself (signup -> login ->
whoami, enumeration-prevention response bodies) is verified live/e2e, same
as Per-Device Sessions Phase 0's get_or_create_session."""

from datetime import datetime, timedelta, timezone

from app.guest_auth import (
    generate_token,
    get_optional_guest,
    hash_password,
    is_auth_token_expired,
    is_password_strong_enough,
    is_reset_token_valid,
    normalize_email,
    verify_password,
)


def test_hashed_password_is_not_stored_in_plaintext():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert hashed.startswith("$2b$")  # bcrypt's own format marker


def test_verify_password_accepts_the_right_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_rejects_the_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_two_hashes_of_the_same_password_are_different():
    # bcrypt salts every hash independently -- confirms gensalt() isn't
    # somehow being reused/fixed.
    assert hash_password("same password") != hash_password("same password")


def test_generate_token_produces_unique_high_entropy_values():
    tokens = {generate_token() for _ in range(1000)}
    assert len(tokens) == 1000
    assert all(len(t) >= 32 for t in tokens)


def test_normalize_email_trims_and_lowercases():
    assert normalize_email("  Guest@Example.COM  ") == "guest@example.com"


def test_password_strength_check_matches_the_documented_minimum():
    assert is_password_strong_enough("1234567") is False
    assert is_password_strong_enough("12345678") is True


def test_reset_token_valid_when_unused_and_unexpired():
    now = datetime.now(timezone.utc)
    assert is_reset_token_valid(now + timedelta(hours=1), None, now=now) is True


def test_reset_token_invalid_once_used():
    now = datetime.now(timezone.utc)
    assert is_reset_token_valid(now + timedelta(hours=1), used_at=now, now=now) is False


def test_reset_token_invalid_once_expired():
    now = datetime.now(timezone.utc)
    assert is_reset_token_valid(now - timedelta(minutes=1), None, now=now) is False


def test_auth_token_not_expired_within_sliding_window():
    now = datetime.now(timezone.utc)
    assert is_auth_token_expired(now - timedelta(days=89), now=now) is False


def test_auth_token_expired_past_sliding_window():
    now = datetime.now(timezone.utc)
    assert is_auth_token_expired(now - timedelta(days=91), now=now) is True


# Guest Accounts Phase 1: get_optional_guest (used by the Coins/Collectibles
# routers) must treat a missing/blank header as "anonymous", never a 401 --
# unlike get_current_guest, it's not gating an account-specific endpoint.
# Both cases below short-circuit before touching the DB, so they're safe to
# run without a live Supabase project, same as this file's other tests.
def test_get_optional_guest_returns_none_for_a_missing_header():
    assert get_optional_guest(None) is None


def test_get_optional_guest_returns_none_for_a_blank_header():
    assert get_optional_guest("   ") is None
