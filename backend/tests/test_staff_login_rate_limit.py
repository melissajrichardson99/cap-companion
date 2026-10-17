"""POST /staff/login's per-IP failure limiter (app/rate_limit.py), through
the real route with a controlled clock -- no real sleeps."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import rate_limit, staff_auth
from app.main import app

PASSWORD = "correct-horse"


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 10_000.0}
    monkeypatch.setattr(rate_limit, "_clock", lambda: now["t"])
    return now


@pytest.fixture
def client(monkeypatch, clock):
    monkeypatch.setattr(staff_auth, "STAFF_PASSWORD", PASSWORD)
    monkeypatch.setattr(staff_auth, "STAFF_SESSION_SECRET", "test-secret")
    monkeypatch.setattr(staff_auth, "_serializer", None)
    rate_limit.reset_staff_login_failures()
    yield TestClient(app)
    rate_limit.reset_staff_login_failures()


def _login(client, password, ip="203.0.113.7", forwarded=None):
    headers = {"X-Forwarded-For": forwarded if forwarded is not None else ip}
    return client.post("/staff/login", json={"password": password}, headers=headers)


def _fail(client, times, **kwargs):
    for _ in range(times):
        assert _login(client, "wrong", **kwargs).status_code == 401


def test_a_normal_login_is_unaffected(client):
    res = _login(client, PASSWORD)
    assert res.status_code == 200
    assert res.json()["token"]


def test_a_few_typos_then_the_right_password_logs_in(client):
    _fail(client, 4)
    assert _login(client, PASSWORD).status_code == 200


def test_five_failures_lock_the_ip_out_with_a_429(client):
    _fail(client, 5)
    res = _login(client, "wrong")
    assert res.status_code == 429
    assert res.json()["detail"] == "Too many incorrect password attempts. Please wait 10 minutes and try again."
    assert int(res.headers["retry-after"]) == 600


def test_even_the_correct_password_is_refused_while_locked_out(client):
    _fail(client, 5)
    assert _login(client, PASSWORD).status_code == 429


def test_success_resets_the_failure_count(client):
    _fail(client, 4)
    assert _login(client, PASSWORD).status_code == 200
    _fail(client, 4)
    assert _login(client, PASSWORD).status_code == 200


def test_lockout_lifts_once_the_window_passes(client, clock):
    _fail(client, 5)
    clock["t"] += rate_limit.STAFF_LOGIN_WINDOW_SECONDS - 1
    assert _login(client, PASSWORD).status_code == 429
    clock["t"] += 2
    assert _login(client, PASSWORD).status_code == 200


def test_window_slides_failures_age_out_one_at_a_time(client, clock):
    for _ in range(5):
        assert _login(client, "wrong").status_code == 401
        clock["t"] += 60
    # Failures at t0..t0+240; now t0+300. The first one ages out at t0+600.
    assert _login(client, "wrong").status_code == 429
    clock["t"] += 301
    assert _login(client, "wrong").status_code == 401
    assert _login(client, "wrong").status_code == 429


def test_retry_after_reflects_remaining_time(client, clock):
    _fail(client, 5)
    clock["t"] += 9 * 60
    res = _login(client, "wrong")
    assert res.status_code == 429
    assert res.json()["detail"] == "Too many incorrect password attempts. Please wait 1 minute and try again."
    assert int(res.headers["retry-after"]) == 60


def test_other_ips_are_not_affected(client):
    _fail(client, 5, ip="203.0.113.7")
    assert _login(client, PASSWORD, ip="198.51.100.20").status_code == 200


def test_spoofed_leading_forwarded_entries_cannot_dodge_the_limit(client):
    # Render appends the address it saw to whatever the client sent, so only
    # the last entry is trustworthy. Rotating a fake first entry each try
    # must still land on the same counter.
    for i in range(5):
        assert _login(client, "wrong", forwarded=f"10.0.0.{i}, 203.0.113.7").status_code == 401
    assert _login(client, PASSWORD, forwarded="10.9.9.9, 203.0.113.7").status_code == 429


def test_falls_back_to_the_peer_address_without_a_forwarded_header(client):
    for _ in range(5):
        assert client.post("/staff/login", json={"password": "wrong"}).status_code == 401
    assert client.post("/staff/login", json={"password": PASSWORD}).status_code == 429


def test_stale_ips_are_pruned_once_the_table_is_large(client, clock, monkeypatch):
    monkeypatch.setattr(rate_limit, "_STAFF_LOGIN_PRUNE_AT", 3)
    for ip in ("192.0.2.1", "192.0.2.2", "192.0.2.3"):
        rate_limit.record_staff_login_failure(ip)
    clock["t"] += rate_limit.STAFF_LOGIN_WINDOW_SECONDS + 1
    rate_limit.record_staff_login_failure("192.0.2.4")
    assert set(rate_limit._staff_login_failures) == {"192.0.2.4"}
