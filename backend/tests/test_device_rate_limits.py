"""Per-device limits on the public write endpoints (app/rate_limit.py's
device_limit_hit / device_rate_limit), on a fake clock (same pattern as
test_staff_login_rate_limit.py):

- each limit lets exactly N through and refuses request N+1 with a 429, a
  human message and Retry-After; another device session is unaffected; the
  count frees up as the window slides; a refused request isn't counted;
- requests with no device session share one small bucket per IP;
- heatmap scan logging over its limit still answers 204 but logs nothing,
  and nothing a guest's progress depends on (the scan itself, Mark
  Visited, coins, Bingo/Map, Hunt) is limited at all;
- RATE_LIMITS_ENABLED=0 turns every one of these off;
- memory stays bounded, and concurrent requests never overshoot a limit.
"""

from __future__ import annotations

import io
import threading

import pytest
from fastapi.routing import APIRoute
from PIL import Image

from app import rate_limit
from app.main import app
from app.rate_limit import CONTACT_STAFF, FAVORITE_PHOTO_UPLOAD, PASSPORT_PHOTO_UPLOAD, PHOTO_VOTE, SCAN_EVENT_LOG
from app.routers import qr_locations as qr_locations_router
from tests.test_reference_cache_routes import CARD, H_CAPY, N_ZOO, S_SHORT, T_ZOO, _as, _logged_scans, client, db  # noqa: F401

HOUR = 60 * 60


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    now = {"t": 1_000_000.0}
    monkeypatch.setattr(rate_limit, "_clock", lambda: now["t"])
    return now


# --- the limiter itself -----------------------------------------------------


@pytest.mark.parametrize("limit", [CONTACT_STAFF, FAVORITE_PHOTO_UPLOAD, PASSPORT_PHOTO_UPLOAD, PHOTO_VOTE, SCAN_EVENT_LOG])
def test_exactly_n_are_allowed_and_n_plus_1_is_refused(limit):
    for _ in range(limit.max_requests):
        assert rate_limit.device_limit_hit(limit, "device-1") is None
    assert rate_limit.device_limit_hit(limit, "device-1") == limit.window_seconds
    assert rate_limit.device_limit_hit(limit, "device-2") is None


def test_the_configured_limits():
    assert (CONTACT_STAFF.max_requests, CONTACT_STAFF.window_seconds) == (5, HOUR)
    assert (FAVORITE_PHOTO_UPLOAD.max_requests, FAVORITE_PHOTO_UPLOAD.window_seconds) == (10, HOUR)
    assert (PASSPORT_PHOTO_UPLOAD.max_requests, PASSPORT_PHOTO_UPLOAD.window_seconds) == (10, HOUR)
    assert (PHOTO_VOTE.max_requests, PHOTO_VOTE.window_seconds) == (60, HOUR)
    assert (SCAN_EVENT_LOG.max_requests, SCAN_EVENT_LOG.window_seconds) == (120, HOUR)


def test_counts_expire_as_the_window_slides(clock):
    for minute in range(5):
        clock["t"] += 60
        assert rate_limit.device_limit_hit(CONTACT_STAFF, "d") is None
    first = clock["t"] - 4 * 60
    clock["t"] += 10
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "d") == int(first + HOUR - clock["t"])
    clock["t"] = first + HOUR  # the first request ages out exactly now
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "d") is None
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "d") is not None  # the 2nd hasn't yet


def test_refused_requests_are_not_counted(clock):
    for _ in range(5):
        rate_limit.device_limit_hit(CONTACT_STAFF, "d")
    for _ in range(50):  # hammering while blocked doesn't push the wait out
        clock["t"] += 1
        rate_limit.device_limit_hit(CONTACT_STAFF, "d")
    clock["t"] = 1_000_000.0 + HOUR
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "d") is None


def test_session_and_anonymous_buckets_are_separate_and_anonymous_is_small():
    for _ in range(CONTACT_STAFF.anonymous_max_requests):
        assert rate_limit.device_limit_hit(CONTACT_STAFF, "203.0.113.9", anonymous=True) is None
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "203.0.113.9", anonymous=True) is not None
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "203.0.113.9") is None  # a session id that happens to match
    for limit in (CONTACT_STAFF, FAVORITE_PHOTO_UPLOAD, PASSPORT_PHOTO_UPLOAD, PHOTO_VOTE, SCAN_EVENT_LOG):
        assert limit.anonymous_max_requests < limit.max_requests


def test_kill_switch_turns_every_device_limit_off(monkeypatch):
    for value in ("0", "false", "OFF", " no "):
        monkeypatch.setenv(rate_limit.RATE_LIMITS_ENABLED_ENV, value)
        assert all(rate_limit.device_limit_hit(CONTACT_STAFF, "d") is None for _ in range(50))
    # Nothing was recorded while off: back on, the device has its full 5.
    monkeypatch.setenv(rate_limit.RATE_LIMITS_ENABLED_ENV, "1")
    assert all(rate_limit.device_limit_hit(CONTACT_STAFF, "d") is None for _ in range(5))
    assert rate_limit.device_limit_hit(CONTACT_STAFF, "d") is not None
    monkeypatch.delenv(rate_limit.RATE_LIMITS_ENABLED_ENV)
    assert rate_limit.device_limits_enabled()  # unset means on


def test_memory_is_bounded(monkeypatch, clock):
    monkeypatch.setattr(rate_limit, "_DEVICE_LIMIT_MAX_KEYS", 3)
    for device in ("a", "b", "c"):
        rate_limit.device_limit_hit(PHOTO_VOTE, device)
    clock["t"] += HOUR + 1  # all three expire
    rate_limit.device_limit_hit(PHOTO_VOTE, "d")
    assert set(rate_limit._device_hits) == {("photo-vote", "session:d")}
    for device in ("e", "f", "g", "h"):  # none expired: least recently used goes
        rate_limit.device_limit_hit(PHOTO_VOTE, device)
    assert len(rate_limit._device_hits) <= 3
    assert ("photo-vote", "session:h") in rate_limit._device_hits
    assert all(len(hits) <= PHOTO_VOTE.max_requests for hits in rate_limit._device_hits.values())


def test_concurrent_requests_never_overshoot():
    allowed = []
    barrier = threading.Barrier(20)

    def worker():
        barrier.wait()
        for _ in range(10):
            if rate_limit.device_limit_hit(PHOTO_VOTE, "shared-device") is None:
                allowed.append(1)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(allowed) == PHOTO_VOTE.max_requests


# --- through the routes -----------------------------------------------------


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), "teal").save(buf, "JPEG")
    return buf.getvalue()


def _contact(client, token):
    return client.post("/staff-requests", headers=_as(token), json={"type": "general_question", "location_node_id": N_ZOO})


def _favorite(client, token):
    headers = _as(token) if token else {}
    return client.post("/photos/submit", headers=headers, files={"file": ("p.jpg", _jpeg(), "image/jpeg")})


def _passport(client, token):
    return client.post(
        "/passport/generate", headers=_as(token), data={"family_label": "Testers"}, files={"file": ("p.jpg", _jpeg(), "image/jpeg")}
    )


def _vote(client, token):
    return client.post(f"/photos/{S_SHORT}/vote", headers=_as(token))


ROUTE_CASES = [
    (_contact, CONTACT_STAFF),
    (_favorite, FAVORITE_PHOTO_UPLOAD),
    (_passport, PASSPORT_PHOTO_UPLOAD),
    (_vote, PHOTO_VOTE),
]
ROUTE_IDS = ["contact-staff", "favorite-photo", "family-passport", "photo-vote"]


@pytest.fixture
def seeded(db):
    """The shared route-test data (map, Bingo card, Hunt, a shortlisted
    photo -- tests/test_reference_cache_routes.py)."""
    return db


@pytest.mark.parametrize(("send", "limit"), ROUTE_CASES, ids=ROUTE_IDS)
def test_route_refuses_request_n_plus_1_with_a_readable_429(client, seeded, send, limit, clock):
    for i in range(limit.max_requests):
        res = send(client, "busy-device")
        # Not every one succeeds (a 2nd open help request is a 409, a repeat
        # vote is a 409) -- every attempt still counts.
        assert res.status_code != 429, (i, res.text)
        clock["t"] += 1
    res = send(client, "busy-device")
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) == limit.window_seconds - limit.max_requests
    detail = res.json()["detail"]
    assert "Please wait" in detail and "minutes" in detail
    assert "{wait}" not in detail

    assert send(client, "another-device").status_code != 429  # unaffected


def test_429_carries_cors_headers_so_the_app_can_show_the_message(client, seeded):
    for _ in range(CONTACT_STAFF.max_requests):
        _contact(client, "busy-device")
    res = client.post(
        "/staff-requests",
        headers={**_as("busy-device"), "Origin": "http://localhost:5173"},
        json={"type": "general_question", "location_node_id": N_ZOO},
    )
    assert res.status_code == 429
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_a_refused_upload_is_never_processed_or_stored(client, seeded, monkeypatch):
    for _ in range(FAVORITE_PHOTO_UPLOAD.max_requests):
        assert _favorite(client, "busy-device").status_code == 200
    stored = len(seeded.storage_objects)
    from app import uploads

    monkeypatch.setattr(uploads, "prepare_image", lambda *a: pytest.fail("processed a refused upload"))
    assert _favorite(client, "busy-device").status_code == 429
    assert len(seeded.storage_objects) == stored


def test_an_upload_with_no_device_session_uses_the_small_per_ip_bucket(client, seeded):
    for _ in range(FAVORITE_PHOTO_UPLOAD.anonymous_max_requests):
        assert _favorite(client, None).status_code == 200
    assert _favorite(client, None).status_code == 429
    # A real guest on the same address (they always send a session) is fine.
    assert _favorite(client, "guest-on-same-wifi").status_code == 200


def test_kill_switch_lets_everything_through_the_routes(client, seeded, monkeypatch):
    monkeypatch.setenv(rate_limit.RATE_LIMITS_ENABLED_ENV, "0")
    for _ in range(CONTACT_STAFF.max_requests + 3):
        assert _contact(client, "busy-device").status_code != 429
    for _ in range(PHOTO_VOTE.max_requests + 3):
        assert _vote(client, "busy-device").status_code != 429


def test_exactly_these_routes_carry_a_device_limit():
    def limits_on(dependant):
        found = set()
        for dep in dependant.dependencies:
            limit = getattr(dep.call, "device_limit", None)
            if limit is not None:
                found.add(limit.name)
            found |= limits_on(dep)
        return found

    limited = {}
    for route in app.routes:
        if isinstance(route, APIRoute):
            names = limits_on(route.dependant)
            if names:
                for method in route.methods:
                    limited[(method, route.path)] = names
    assert limited == {
        ("POST", "/staff-requests"): {"contact-staff"},
        ("POST", "/photos/submit"): {"favorite-photo-upload"},
        ("POST", "/passport/generate"): {"passport-photo-upload"},
        ("POST", "/photos/{submission_id}/vote"): {"photo-vote"},
    }


# --- heatmap scan logging --------------------------------------------------


def _scan_event(client, token):
    return client.post("/scan-events", headers=_as(token), json={"type": "scan", "id": "brave-otter"})


@pytest.fixture
def no_debounce(monkeypatch):
    # The same arrival repeated within 5s is deduplicated before the limit
    # is even consulted; turn that off so each call is a fresh arrival.
    monkeypatch.setattr(qr_locations_router, "_is_duplicate", lambda key: False)


def test_scan_logging_over_the_limit_is_silently_dropped(client, seeded, no_debounce):
    for _ in range(SCAN_EVENT_LOG.max_requests):
        assert _scan_event(client, "scanner").status_code == 204
    assert len(_logged_scans(seeded)) == SCAN_EVENT_LOG.max_requests

    res = _scan_event(client, "scanner")
    assert res.status_code == 204  # the normal response, no 429
    assert res.content == b""
    assert len(_logged_scans(seeded)) == SCAN_EVENT_LOG.max_requests  # but not logged

    assert _scan_event(client, "someone-else").status_code == 204
    assert len(_logged_scans(seeded)) == SCAN_EVENT_LOG.max_requests + 1


def test_an_unknown_destination_is_still_a_404_over_the_limit(client, seeded, no_debounce):
    for _ in range(SCAN_EVENT_LOG.max_requests + 1):
        _scan_event(client, "scanner")
    res = client.post("/scan-events", headers=_as("scanner"), json={"type": "scan", "id": "no-such-code"})
    assert res.status_code == 404


def test_guest_progress_is_never_affected_by_any_limit(client, seeded, no_debounce, monkeypatch):
    """A device that is over every limit at once -- scan logging, votes,
    help requests, uploads -- still scans, marks visited, completes Bingo,
    unlocks Hunt characters and earns coins exactly as normal."""
    token = "over-every-limit"
    for _ in range(SCAN_EVENT_LOG.max_requests + 5):
        _scan_event(client, token)
    for send, limit in ROUTE_CASES:
        for _ in range(limit.max_requests):
            send(client, token)
        assert send(client, token).status_code == 429

    scan = client.get("/scan/brave-otter", headers=_as(token))
    assert scan.status_code == 200, scan.text
    assert scan.json()["target"]["id"] == H_CAPY

    visit = client.post(f"/map/nodes/{N_ZOO}/visit", headers=_as(token), json={"completed_tile_ids": [T_ZOO]})
    assert visit.status_code == 200, visit.text
    card = client.get(f"/bingo/card/{CARD}", headers=_as(token)).json()
    assert any(t["id"] == T_ZOO and t["completed"] for t in card["tiles"]), card

    assert client.post(f"/hunt/characters/{H_CAPY}/unlock", headers=_as(token)).status_code == 200
    for challenge in (c for c in seeded.tables["hunt_challenges"] if c["character_id"] == H_CAPY):
        res = client.post(f"/hunt/challenges/{challenge['id']}/complete", headers=_as(token))
        assert res.status_code == 200, res.text
    assert res.json()["coins_awarded"] > 0  # finishing the character pays out
    coins = client.get("/coins/summary", headers=_as(token))
    assert coins.status_code == 200, coins.text
    assert coins.json()["total"] > 0
