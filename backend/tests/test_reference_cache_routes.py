"""The reference cache through the real routes (FastAPI TestClient over an
in-memory fake Supabase, tests/fake_supabase.py):

- per-session isolation: a cache warmed by one device never leaks that
  device's visits, completions, Hunt progress or votes to another;
- every staff/API write path shows up on the very next guest request;
- TTL expiry picks up a direct database edit (Math Maze staff time);
- with the kill switch off, every cached endpoint returns byte-for-byte
  what it returns with the cache on (cold and warm);
- a warm cache really does skip the shared reads (hit/miss counters and the
  fake's per-table read counts).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import device_session, reference_cache, supabase_client
from app.main import app
from app.routers import qr_locations as qr_locations_router
from app.staff_auth import require_staff
from tests.fake_supabase import FakeSupabase


def _id() -> str:
    return str(uuid.uuid4())


N_TICKET, N_ZOO, N_ARCADE, N_SKEE = _id(), _id(), _id(), _id()
CARD = _id()
H_CAPY, H_ROO = _id(), _id()
P_MAZE, PC_STANDARD = _id(), _id()
G_TOSS = _id()
ENC = _id()
S_SHORT, S_PENDING, S_PENDING_2 = _id(), _id(), _id()
TILES = [_id() for _ in range(25)]
T_ZOO, T_SKEE = TILES[0], TILES[1]

# Shared tables a guest page load reads; per-session tables are everything
# else (node_visits, session_tile_completions, hunt_progress, ...).
SHARED_TABLES = {
    "map_nodes",
    "bingo_tiles",
    "bingo_cards",
    "minigames",
    "puzzles",
    "puzzle_challenges",
    "scoring_games",
    "game_score_events",
    "hunt_characters",
    "hunt_challenges",
    "announcements",
    "animal_photos",
    "photo_submissions",
    "scannable_codes",
    "encyclopedia_entries",
    "animal_map_locations",
}


def _node(id_, name, parent=None):
    return {
        "id": id_,
        "name": name,
        "category": "attraction",
        "description": f"{name} description",
        "is_open": True,
        "x_pct": 10.0,
        "y_pct": 20.0,
        "parent_node_id": parent,
    }


def _seed(db: FakeSupabase) -> None:
    t = db.tables
    t["map_nodes"] += [
        _node(N_TICKET, "Ticket Booth"),
        _node(N_ZOO, "Petting Zoo"),
        _node(N_ARCADE, "Arcade Pad"),
        _node(N_SKEE, "Skee Ball", parent=N_ARCADE),
    ]
    t["bingo_cards"].append({"id": CARD, "owner_label": "Demo Family", "created_at": "2026-01-01T00:00:00+00:00"})
    for i, tile_id in enumerate(TILES):
        linked = N_ZOO if tile_id == T_ZOO else N_SKEE if tile_id == T_SKEE else None
        t["bingo_tiles"].append(
            {
                "id": tile_id,
                "card_id": CARD,
                "row_index": i // 5,
                "col_index": i % 5,
                "label": f"Tile {i}",
                "linked_map_node_id": linked,
            }
        )
    t["minigames"] += [
        {"id": _id(), "name": "Snake", "engine_group": "grid_drag", "theme": "t", "target_duration_seconds": 30, "phase": 1},
        {"id": _id(), "name": "Whack", "engine_group": "reaction_timing", "theme": "t", "target_duration_seconds": 30, "phase": 2},
    ]
    t["puzzles"].append(
        {"id": P_MAZE, "name": "Math Maze", "rules_text": "rules", "created_at": "2026-01-01T00:00:00+00:00", "map_node_id": None}
    )
    t["puzzle_challenges"].append(
        {
            "id": PC_STANDARD,
            "puzzle_id": P_MAZE,
            "label": "Standard",
            "slug": "math-maze-standard",
            "description": "d",
            "staff_time_seconds": 120,
            "solution_type": "exact",
            "hint_tier_1": "h1",
            "hint_tier_2": "h2",
            "hint_tier_3": "h3",
            "sort_order": 1,
        }
    )
    t["scoring_games"].append(
        {
            "id": G_TOSS,
            "name": "Farm Toss",
            "slug": "farm-toss",
            "rules_text": "r",
            "win_condition_text": "w",
            "scoring_mode": "turn_based",
            "win_condition_type": "first_to",
            "win_threshold": 21,
            "hole_count": None,
            "throws_per_round": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "map_node_id": None,
        }
    )
    t["game_score_events"].append({"id": _id(), "game_id": G_TOSS, "label": "Hit", "point_value": 3, "sort_order": 1})
    for hid, name, order in ((H_CAPY, "Capybara", 1), (H_ROO, "Kangaroo", 2)):
        t["hunt_characters"].append(
            {"id": hid, "name": name, "species_category": "rodent", "minigame_slug": "snake", "sort_order": order, "map_node_id": None}
        )
        for idx in (3, 1, 2):
            t["hunt_challenges"].append(
                {"id": _id(), "character_id": hid, "order_index": idx, "type": "mc", "content": {"q": idx}, "metadata": {}}
            )
    t["encyclopedia_entries"].append({"id": ENC, "animal_name": "Goat", "status": "placeholder"})
    t["scannable_codes"] += [
        {"id": _id(), "code": "brave-otter", "hunt_character_id": H_CAPY, "encyclopedia_entry_id": None},
        {"id": _id(), "code": "quiet-gecko", "hunt_character_id": None, "encyclopedia_entry_id": ENC},
    ]
    t["announcements"].append(
        {"id": _id(), "text": "Welcome!", "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-01T00:00:00+00:00"}
    )
    t["animal_photos"] += [
        {"id": _id(), "animal_slug": "goat", "storage_path": "goat/1.jpg", "display_order": 1},
        {"id": _id(), "animal_slug": "goat", "storage_path": "goat/2.jpg", "display_order": 2},
    ]
    t["photo_submissions"] += [
        {
            "id": S_SHORT,
            "guest_label": "The Smiths",
            "email": "smith@example.com",
            "storage_path": f"{S_SHORT}.jpg",
            "submitted_at": "2026-10-01T00:00:00+00:00",
            "status": "shortlisted",
        },
        {
            "id": S_PENDING,
            "guest_label": "The Lees",
            "email": "lee@example.com",
            "storage_path": f"{S_PENDING}.jpg",
            "submitted_at": "2026-10-02T00:00:00+00:00",
            "status": "pending_review",
        },
        {
            "id": S_PENDING_2,
            "guest_label": None,
            "email": None,
            "storage_path": f"{S_PENDING_2}.jpg",
            "submitted_at": "2026-10-03T00:00:00+00:00",
            "status": "pending_review",
        },
    ]
    t["animal_map_locations"].append({"id": _id(), "animal_slug": "goat", "map_node_id": N_ZOO})


@pytest.fixture
def db(monkeypatch):
    fake = FakeSupabase()
    _seed(fake)
    monkeypatch.setattr(supabase_client, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(supabase_client, "SUPABASE_KEY", "fake-key")
    monkeypatch.setattr(supabase_client, "_client", fake)
    monkeypatch.setattr(device_session, "_recent_sessions", device_session.OrderedDict())
    monkeypatch.setattr(qr_locations_router, "_recent_scans", {})
    app.dependency_overrides[require_staff] = lambda: None
    yield fake
    app.dependency_overrides.pop(require_staff, None)


@pytest.fixture
def client(db):
    return TestClient(app)


def _as(token: str) -> dict:
    return {"X-Device-Session": token}


def _get(client, path, token="guest-a"):
    res = client.get(path, headers=_as(token))
    assert res.status_code == 200, (path, res.status_code, res.text)
    return res.json()


# Every guest GET that reads cached reference data.
CACHED_ENDPOINTS = [
    "/map/nodes",
    "/bingo/cards",
    f"/bingo/card/{CARD}",
    "/bingo/minigames",
    "/puzzles",
    "/scoring/games",
    "/hunt/characters",
    "/announcements",
    "/animal-photos",
    "/photos/gallery",
    "/photos/of-the-day",
    "/scan/brave-otter",
    "/scan/quiet-gecko",
]


def _give_session_some_progress(client, token):
    """Per-session state on top of the shared data, so the comparisons and
    isolation checks below have something session-specific to get wrong."""
    res = client.post(f"/map/nodes/{N_ZOO}/visit", headers=_as(token), json={"completed_tile_ids": [T_ZOO]})
    assert res.status_code == 200, res.text
    assert client.post(f"/hunt/characters/{H_CAPY}/unlock", headers=_as(token)).status_code == 200
    assert client.post(f"/photos/{S_SHORT}/vote", headers=_as(token)).status_code == 200


# --- per-session isolation -------------------------------------------------


def test_warm_cache_never_leaks_one_sessions_progress_to_another(client, db):
    _give_session_some_progress(client, "guest-a")
    # Warm every cached endpoint as session A.
    a_first = {path: _get(client, path, "guest-a") for path in CACHED_ENDPOINTS}

    reference_cache.reset_stats()
    for token in ("guest-b", "brand-new-device"):
        nodes = {n["id"]: n for n in _get(client, "/map/nodes", token)}
        assert nodes[N_ZOO]["visited"] is False
        assert all(not t["completed"] for t in nodes[N_ZOO]["linked_tiles"])
        card = _get(client, f"/bingo/card/{CARD}", token)
        assert all(not t["completed"] for t in card["tiles"])
        hunt = {c["id"]: c for c in _get(client, "/hunt/characters", token)}
        assert hunt[H_CAPY]["unlocked"] is False
        scan = _get(client, "/scan/brave-otter", token)
        assert scan["target"]["unlocked"] is False
        gallery = _get(client, "/photos/gallery", token)
        assert gallery[0]["voted_by_me"] is False
        assert gallery[0]["vote_count"] == 1  # the shared count does include A's vote

    # ...and these all came from the warm cache, not fresh shared reads.
    stats = reference_cache.stats()
    assert all(s["misses"] == 0 for s in stats.values()), stats

    # A still sees exactly its own progress after B and the fresh device.
    assert {path: _get(client, path, "guest-a") for path in CACHED_ENDPOINTS} == a_first
    a_nodes = {n["id"]: n for n in a_first["/map/nodes"]}
    assert a_nodes[N_ZOO]["visited"] is True
    assert [t["completed"] for t in a_nodes[N_ZOO]["linked_tiles"]] == [True]
    assert a_first["/photos/gallery"][0]["voted_by_me"] is True
    assert a_first["/scan/brave-otter"]["target"]["unlocked"] is True


def test_guest_gallery_never_exposes_email_even_though_staff_view_does(client, db):
    assert _get(client, "/photos/gallery")[0]["email"] is None
    assert _get(client, "/photos/of-the-day")["email"] is None
    staff = client.get("/photos/shortlisted").json()
    assert staff[0]["email"] == "smith@example.com"
    # The staff view never goes through (or fills) the cache.
    assert "photo_gallery" not in reference_cache.stats() or reference_cache.stats()["photo_gallery"]["misses"] == 1
    assert _get(client, "/photos/gallery")[0]["email"] is None


def test_warm_cache_skips_every_shared_read(client, db):
    for path in CACHED_ENDPOINTS:
        _get(client, path)
    db.reset_counts()
    for path in CACHED_ENDPOINTS:
        _get(client, path, "another-device")
    shared_reads = {t: n for t, n in db.reads.items() if t in SHARED_TABLES}
    assert shared_reads == {}, shared_reads


# --- invalidation on every write path --------------------------------------


def _node_open(client, node_id, token="guest-a"):
    return next(n for n in _get(client, "/map/nodes", token) if n["id"] == node_id)["is_open"]


def test_staff_closing_and_reopening_a_node_is_live_immediately(client, db):
    assert _node_open(client, N_TICKET) is True
    assert client.patch(f"/map/nodes/{N_TICKET}/status", json={"is_open": False}).status_code == 200
    assert _node_open(client, N_TICKET) is False
    assert _node_open(client, N_TICKET, "other-guest") is False
    assert client.patch(f"/map/nodes/{N_TICKET}/status", json={"is_open": True}).status_code == 200
    assert _node_open(client, N_TICKET) is True


def test_node_closure_reaches_the_map_exploration_bonus_immediately(client, db):
    """visit_node reads is_open from the cached nodes to decide the bonus;
    closing every other top-level node must count at once."""
    for node_id in (N_ZOO, N_ARCADE):
        client.post(f"/map/nodes/{node_id}/visit", headers=_as("explorer"), json={"completed_tile_ids": []})
    client.patch(f"/map/nodes/{N_TICKET}/status", json={"is_open": False})
    # Every open top-level node is now visited, so the next visit pays out.
    res = client.post(f"/map/nodes/{N_ZOO}/visit", headers=_as("explorer"), json={"completed_tile_ids": []})
    assert res.json()["coins_awarded"] == 50


def test_announcement_create_edit_delete_are_live_immediately(client, db):
    assert [a["text"] for a in _get(client, "/announcements")] == ["Welcome!"]
    created = client.post("/announcements", json={"text": "Splash pad closed"}).json()
    assert [a["text"] for a in _get(client, "/announcements")] == ["Splash pad closed", "Welcome!"]
    client.patch(f"/announcements/{created['id']}", json={"text": "Splash pad open again"})
    assert _get(client, "/announcements")[0]["text"] == "Splash pad open again"
    assert client.delete(f"/announcements/{created['id']}").status_code == 204
    assert [a["text"] for a in _get(client, "/announcements")] == ["Welcome!"]


def test_animal_photo_upload_delete_reorder_are_live_immediately(client, db):
    before = _get(client, "/animal-photos")
    assert len(before) == 2

    res = client.post("/animal-photos/goat", files={"file": ("new.jpg", b"jpegbytes", "image/jpeg")})
    assert res.status_code == 200, res.text
    uploaded = res.json()
    after_upload = _get(client, "/animal-photos")
    assert [p["id"] for p in after_upload] == [p["id"] for p in before] + [uploaded["id"]]

    new_order = [uploaded["id"], before[1]["id"], before[0]["id"]]
    assert client.put("/animal-photos/goat/reorder", json={"photo_ids": new_order}).status_code == 200
    assert [p["id"] for p in _get(client, "/animal-photos")] == new_order

    assert client.delete(f"/animal-photos/{uploaded['id']}").status_code == 204
    assert [p["id"] for p in _get(client, "/animal-photos")] == [before[1]["id"], before[0]["id"]]


def test_photo_shortlist_reject_delete_and_clear_are_live_immediately(client, db):
    assert [p["id"] for p in _get(client, "/photos/gallery")] == [S_SHORT]
    assert _get(client, "/photos/of-the-day")["id"] == S_SHORT

    assert client.post(f"/photos/{S_PENDING}/shortlist").status_code == 200
    assert [p["id"] for p in _get(client, "/photos/gallery")] == [S_SHORT, S_PENDING]

    invalidations = reference_cache.stats()["photo_gallery"]["invalidations"]
    assert client.post(f"/photos/{S_PENDING_2}/reject").status_code == 200
    assert reference_cache.stats()["photo_gallery"]["invalidations"] == invalidations + 1
    assert [p["id"] for p in _get(client, "/photos/gallery")] == [S_SHORT, S_PENDING]

    assert client.delete(f"/photos/{S_SHORT}").status_code == 204
    assert [p["id"] for p in _get(client, "/photos/gallery")] == [S_PENDING]
    assert _get(client, "/photos/of-the-day")["id"] == S_PENDING

    assert client.delete("/photos/shortlisted").json() == {"deleted": 1}
    assert _get(client, "/photos/gallery") == []
    assert client.get("/photos/of-the-day", headers=_as("guest-a")).json() is None


def test_a_vote_is_live_immediately_for_every_guest(client, db):
    client.post(f"/photos/{S_PENDING}/shortlist")
    assert [p["vote_count"] for p in _get(client, "/photos/gallery", "watcher")] == [0, 0]
    assert _get(client, "/photos/of-the-day", "watcher")["id"] == S_SHORT  # tie -> first submitted

    assert client.post(f"/photos/{S_PENDING}/vote", headers=_as("voter")).status_code == 200
    gallery = _get(client, "/photos/gallery", "watcher")
    assert [p["vote_count"] for p in gallery] == [0, 1]
    assert [p["voted_by_me"] for p in gallery] == [False, False]
    assert _get(client, "/photos/of-the-day", "watcher")["id"] == S_PENDING
    assert [p["voted_by_me"] for p in _get(client, "/photos/gallery", "voter")] == [False, True]


def test_reset_session_removing_votes_is_live_immediately(client, db):
    client.post(f"/photos/{S_SHORT}/vote", headers=_as("voter"))
    assert _get(client, "/photos/gallery", "watcher")[0]["vote_count"] == 1
    assert client.post("/session/reset", headers=_as("voter")).json()["photo_votes_reset"] == 1
    assert _get(client, "/photos/gallery", "watcher")[0]["vote_count"] == 0


def _logged_scans(db):
    return [(r["destination_type"], r["destination_id"], r["source_id"]) for r in db.tables["map_node_visit_events"]]


@pytest.mark.parametrize(
    ("dest_type", "dest_id", "scan_type", "scan_id"),
    [
        ("animal", "goat", "animal", "goat"),
        ("hunt_character", H_CAPY, "scan", "brave-otter"),
        ("scoring_game", G_TOSS, "scoring", "farm-toss"),
        ("puzzle", P_MAZE, "puzzle", "math-maze-standard"),
    ],
)
def test_qr_location_edit_is_live_immediately(client, db, dest_type, dest_id, scan_type, scan_id):
    def scan(token):
        res = client.post("/scan-events", headers=_as(token), json={"type": scan_type, "id": scan_id})
        assert res.status_code == 204, res.text

    scan("first-scanner")  # warms the lookup tables
    res = client.put(f"/staff/qr-locations/{dest_type}/{dest_id}", json={"map_node_id": N_TICKET})
    assert res.status_code == 200, res.text
    scan("second-scanner")
    assert _logged_scans(db)[-1][2] == N_TICKET

    client.put(f"/staff/qr-locations/{dest_type}/{dest_id}", json={"map_node_id": None})
    scan("third-scanner")
    assert _logged_scans(db)[-1][2] is None


# --- TTL --------------------------------------------------------------------


def test_direct_db_edit_shows_after_the_ttl_without_a_restart(client, db, monkeypatch):
    """Math Maze staff times are typed straight into the database, with no
    API call to invalidate anything: the default TTL bounds the delay."""
    now = {"t": 5000.0}
    monkeypatch.setattr(reference_cache, "_clock", lambda: now["t"])

    def staff_time():
        return _get(client, "/puzzles")[0]["challenges"][0]["staff_time_seconds"]

    assert staff_time() == 120
    db.tables["puzzle_challenges"][0]["staff_time_seconds"] = 95  # SQL editor
    assert staff_time() == 120  # still cached
    now["t"] += reference_cache.DEFAULT_TTL - 1
    assert staff_time() == 120
    now["t"] += 2
    assert staff_time() == 95


# --- kill switch / byte-for-byte equivalence --------------------------------


def _bodies(client, token):
    out = {}
    for path in CACHED_ENDPOINTS:
        res = client.get(path, headers=_as(token))
        assert res.status_code == 200, (path, res.text)
        out[path] = res.content
    return out


def test_responses_are_byte_identical_with_the_cache_on_and_off(client, db, monkeypatch):
    _give_session_some_progress(client, "guest-a")

    monkeypatch.setenv("REFERENCE_CACHE_ENABLED", "0")
    reference_cache.clear()
    reference_cache.reset_stats()
    off = _bodies(client, "guest-a")
    off_other = _bodies(client, "guest-b")
    assert reference_cache.stats() == {}  # nothing cached, nothing counted

    monkeypatch.setenv("REFERENCE_CACHE_ENABLED", "1")
    cold = _bodies(client, "guest-a")
    warm = _bodies(client, "guest-a")
    warm_other = _bodies(client, "guest-b")

    assert cold == off
    assert warm == off
    assert warm_other == off_other


def test_kill_switch_makes_every_request_read_the_database(client, db, monkeypatch):
    monkeypatch.setenv("REFERENCE_CACHE_ENABLED", "off")
    _get(client, "/announcements")
    db.reset_counts()
    _get(client, "/announcements")
    assert db.reads["announcements"] == 1
    # A write path still works (its invalidate is harmless with the cache off).
    client.post("/announcements", json={"text": "hi"})
    assert [a["text"] for a in _get(client, "/announcements")] == ["hi", "Welcome!"]
