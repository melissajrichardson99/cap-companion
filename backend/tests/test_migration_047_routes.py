"""Migration 047 through the real routes (FastAPI TestClient over the
in-memory fake Supabase, tests/fake_supabase.py):

- Farm Toss: entries for the 2/3/4/5/6/Miss events are accepted and totalled
  by point value; a score event the game doesn't have (7 points, or another
  game's event) is still rejected with the existing 404.
- Coming-soon nodes (map_nodes.coming_soon): GET /map/nodes reports the flag,
  a visit is refused with 409 and writes nothing (no node_visits row, no
  heatmap event), the node doesn't count towards Map Exploration, and staff
  opening it clears the flag so it becomes a normal node.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import device_session, supabase_client
from app.main import app
from app.staff_auth import require_staff
from tests.fake_supabase import FakeSupabase


def _id() -> str:
    return str(uuid.uuid4())


N_WEST, N_EAST, N_BEE, N_BUILDING = _id(), _id(), _id(), _id()
G_TOSS, G_HOOPS = _id(), _id()
FARM_TOSS_EVENTS = {label: _id() for label in ("2-Point Ring", "3-Point Ring", "4-Point Ring", "5-Point Ring", "6-Point Ring", "Miss")}
HOOPS_EVENT = _id()


def _node(id_, name, *, is_open=True, coming_soon=False):
    return {
        "id": id_,
        "name": name,
        "category": "attraction",
        "description": f"{name} description",
        "is_open": is_open,
        "coming_soon": coming_soon,
        "x_pct": 50.0,
        "y_pct": 50.0,
        "parent_node_id": None,
    }


def _game(id_, name, slug, threshold):
    return {
        "id": id_,
        "name": name,
        "slug": slug,
        "rules_text": "r",
        "win_condition_text": "w",
        "scoring_mode": "turn_based",
        "win_condition_type": "first_to",
        "win_threshold": threshold,
        "hole_count": None,
        "throws_per_round": None,
        "created_at": "2026-01-01T00:00:00+00:00",
        "map_node_id": None,
    }


@pytest.fixture
def db(monkeypatch):
    fake = FakeSupabase()
    t = fake.tables
    t["map_nodes"] += [
        _node(N_WEST, "Tractor Ride - West"),
        _node(N_EAST, "Tractor Ride - East"),
        _node(N_BEE, "Bee Maze"),
        _node(N_BUILDING, "New Building (Coming Soon)", is_open=False, coming_soon=True),
    ]
    t["bingo_cards"].append({"id": _id(), "owner_label": "Demo Family", "created_at": "2026-01-01T00:00:00+00:00"})
    t["scoring_games"] += [_game(G_TOSS, "Farm Toss", "farm-toss", 21), _game(G_HOOPS, "Horse Hoops", "horse-hoops", 10)]
    values = {"2-Point Ring": 2, "3-Point Ring": 3, "4-Point Ring": 4, "5-Point Ring": 5, "6-Point Ring": 6, "Miss": 0}
    for order, (label, event_id) in enumerate(FARM_TOSS_EVENTS.items(), start=1):
        sort_order = 99 if label == "Miss" else order
        t["game_score_events"].append(
            {"id": event_id, "game_id": G_TOSS, "label": label, "point_value": values[label], "sort_order": sort_order}
        )
    t["game_score_events"].append({"id": HOOPS_EVENT, "game_id": G_HOOPS, "label": "Hit Horse", "point_value": 1, "sort_order": 1})
    monkeypatch.setattr(supabase_client, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(supabase_client, "SUPABASE_KEY", "fake-key")
    monkeypatch.setattr(supabase_client, "_client", fake)
    monkeypatch.setattr(device_session, "_recent_sessions", device_session.OrderedDict())
    app.dependency_overrides[require_staff] = lambda: None
    yield fake
    app.dependency_overrides.pop(require_staff, None)


@pytest.fixture
def client(db):
    return TestClient(app)


def _as(token: str) -> dict:
    return {"X-Device-Session": token}


# --- Farm Toss ---------------------------------------------------------------


def test_farm_toss_offers_2_3_4_5_6_and_miss_in_ascending_order(client, db):
    games = client.get("/scoring/games", headers=_as("guest")).json()
    farm_toss = next(g for g in games if g["name"] == "Farm Toss")
    assert [(e["label"], e["point_value"], e["is_miss"]) for e in farm_toss["score_events"]] == [
        ("2-Point Ring", 2, False),
        ("3-Point Ring", 3, False),
        ("4-Point Ring", 4, False),
        ("5-Point Ring", 5, False),
        ("6-Point Ring", 6, False),
        ("Miss", 0, True),
    ]


def _start(client, token="guest"):
    res = client.post("/scoring/sessions", headers=_as(token), json={"game_id": G_TOSS, "players": ["Ann"]})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _throw(client, session_id, event_id, token="guest"):
    return client.post(
        f"/scoring/sessions/{session_id}/entries",
        headers=_as(token),
        json={"player_name": "Ann", "score_event_id": event_id},
    )


def test_farm_toss_accepts_4_and_5_and_totals_a_mixed_round(client, db):
    session_id = _start(client)
    for label in ("2-Point Ring", "3-Point Ring", "4-Point Ring", "5-Point Ring", "6-Point Ring", "Miss"):
        res = _throw(client, session_id, FARM_TOSS_EVENTS[label])
        assert res.status_code == 200, (label, res.text)
    body = res.json()
    assert body["totals"] == {"Ann": 20}
    assert [e["point_value"] for e in body["entries"]] == [2, 3, 4, 5, 6, 0]
    assert body["status"] == "in_progress"


@pytest.mark.parametrize("event_id", [_id(), HOOPS_EVENT], ids=["7-point (no such event)", "another game's event"])
def test_farm_toss_still_rejects_scores_it_does_not_have(client, db, event_id):
    session_id = _start(client)
    res = _throw(client, session_id, event_id)
    assert res.status_code == 404
    assert res.json()["detail"] == f"Score event {event_id} not found for this game"
    assert db.tables["score_entries"] == []


# --- coming-soon nodes ---------------------------------------------------------


def _nodes(client, token="guest"):
    return {n["name"]: n for n in client.get("/map/nodes", headers=_as(token)).json()}


def test_map_nodes_report_coming_soon(client, db):
    nodes = _nodes(client)
    assert nodes["New Building (Coming Soon)"]["coming_soon"] is True
    assert nodes["New Building (Coming Soon)"]["is_open"] is False
    for name in ("Tractor Ride - West", "Tractor Ride - East", "Bee Maze"):
        assert nodes[name]["coming_soon"] is False
        assert nodes[name]["is_open"] is True


def test_a_coming_soon_node_cannot_be_visited_and_logs_nothing(client, db):
    res = client.post(f"/map/nodes/{N_BUILDING}/visit", headers=_as("guest"), json={"completed_tile_ids": []})
    assert res.status_code == 409
    assert res.json()["detail"] == "New Building (Coming Soon) isn't open yet."
    assert db.tables["node_visits"] == []
    assert db.tables["map_node_visit_events"] == []
    assert db.tables["coin_awards"] == []


def test_map_exploration_counts_the_new_nodes_but_not_the_coming_soon_one(client, db):
    def visit(node_id):
        res = client.post(f"/map/nodes/{node_id}/visit", headers=_as("explorer"), json={"completed_tile_ids": []})
        assert res.status_code == 200, res.text
        return res.json()["coins_awarded"]

    assert visit(N_WEST) == 0
    assert visit(N_EAST) == 0  # Bee Maze still unvisited
    # The last open node completes the map; the coming-soon one isn't needed.
    assert visit(N_BEE) == 50


def test_a_coming_soon_node_counts_even_if_someone_sets_is_open_without_clearing_it(client, db):
    """Defence in depth: exploration ignores coming_soon nodes on their own,
    not only because they start closed."""
    next(n for n in db.tables["map_nodes"] if n["id"] == N_BUILDING)["is_open"] = True
    for node_id in (N_WEST, N_EAST):
        client.post(f"/map/nodes/{node_id}/visit", headers=_as("explorer"), json={"completed_tile_ids": []})
    res = client.post(f"/map/nodes/{N_BEE}/visit", headers=_as("explorer"), json={"completed_tile_ids": []})
    assert res.json()["coins_awarded"] == 50


def test_staff_opening_a_coming_soon_node_makes_it_a_normal_node(client, db):
    res = client.patch(f"/map/nodes/{N_BUILDING}/status", json={"is_open": True})
    assert res.status_code == 200
    assert res.json()["is_open"] is True
    assert res.json()["coming_soon"] is False
    assert _nodes(client)["New Building (Coming Soon)"]["coming_soon"] is False
    visit = client.post(f"/map/nodes/{N_BUILDING}/visit", headers=_as("guest"), json={"completed_tile_ids": []})
    assert visit.status_code == 200


def test_staff_closing_a_normal_node_leaves_coming_soon_alone(client, db):
    assert client.patch(f"/map/nodes/{N_BEE}/status", json={"is_open": False}).status_code == 200
    assert client.patch(f"/map/nodes/{N_BEE}/status", json={"is_open": True}).status_code == 200
    bee = next(n for n in db.tables["map_nodes"] if n["id"] == N_BEE)
    assert bee["coming_soon"] is False
    # Closing the coming-soon node again doesn't clear the flag either.
    assert client.patch(f"/map/nodes/{N_BUILDING}/status", json={"is_open": False}).status_code == 200
    assert next(n for n in db.tables["map_nodes"] if n["id"] == N_BUILDING)["coming_soon"] is True


def test_a_database_without_the_column_still_works(client, db):
    """The backend may deploy before migration 047 runs."""
    for row in db.tables["map_nodes"]:
        row.pop("coming_soon")
    assert all(n["coming_soon"] is False for n in _nodes(client).values())
    res = client.patch(f"/map/nodes/{N_BUILDING}/status", json={"is_open": True})
    assert res.status_code == 200
    assert "coming_soon" not in next(n for n in db.tables["map_nodes"] if n["id"] == N_BUILDING)
