"""Unit tests for the Staff Visit Heatmap's pure filter math
(app.services.heatmap) -- park-local (America/Edmonton) day/hour bucketing
and the UTC date-range bounds. No real Supabase client needed: get_heatmap
runs against a fake that applies the query's own UTC bounds.

Edmonton offsets per the pinned tzdata (2026e): MST UTC-7 / MDT UTC-6, last
fall-back Nov 2 2025 02:00 MDT -> 01:00 MST, then a spring-forward on Mar 8
2026 02:00 MST -> 03:00 MDT after which Alberta stays on UTC-6 year-round --
there is no Nov 2026 fall-back. The DST tests use those real transitions."""

from datetime import date, datetime, timezone

import pytest

from app.models import HeatmapSource
from app.services import heatmap
from app.services.heatmap import PARK_TIMEZONE, HeatmapFilterError, _count_events, _utc_bounds, get_heatmap

FRIDAY, SATURDAY, SUNDAY = 4, 5, 6


def _row(source_id: str | None, iso: str, source_type: str = "map_node", destination: tuple[str, str] | None = None) -> dict:
    dtype, did = destination or (None, None)
    return {
        "source_type": source_type,
        "source_id": source_id,
        "destination_type": dtype,
        "destination_id": did,
        "visited_at": iso,
    }


class _FakeQuery:
    """Just enough of a postgrest builder for get_heatmap: honours the
    .gte/.lt visited_at bounds so the date-range math is exercised too."""

    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._lo: datetime | None = None
        self._hi: datetime | None = None
        self._types: list[str] | None = None

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def in_(self, _col, values):
        self._types = values
        return self

    def order(self, *_):
        return self

    def gte(self, _col, value):
        self._lo = datetime.fromisoformat(value)
        return self

    def lt(self, _col, value):
        self._hi = datetime.fromisoformat(value)
        return self

    def range(self, offset, _end):
        self._offset = offset
        return self

    def execute(self):
        data = [
            r
            for r in self._rows
            if self._lo <= datetime.fromisoformat(r["visited_at"]) < self._hi
            and (self._types is None or r["source_type"] in self._types)
        ] if self._offset == 0 else []
        return type("Resp", (), {"data": data})()


class _FakeNodes:
    def __init__(self, nodes: list[dict]):
        self._nodes = nodes

    def select(self, *_):
        return self

    def execute(self):
        return type("Resp", (), {"data": self._nodes})()


# Arcade Pad (top-level pin) with Cornhole as its child, plus Goats.
NODES = [
    {"id": "arcade", "parent_node_id": None},
    {"id": "cornhole", "parent_node_id": "arcade"},
    {"id": "goats", "parent_node_id": None},
]


@pytest.fixture
def events(monkeypatch):
    rows: list[dict] = []
    nodes = NODES

    class _Client:
        def table(self, name):
            if name == "map_nodes":
                return _FakeNodes(nodes)
            return _FakeQuery(rows)

    monkeypatch.setattr(heatmap, "get_supabase_client", lambda: _Client())
    return rows


def _visits(summary, source_id="a") -> int:
    return next((c.visits for c in summary.counts if c.source_id == source_id), 0)


def test_park_timezone_is_edmonton():
    assert str(PARK_TIMEZONE) == "America/Edmonton"


def test_counts_every_occurrence_without_dedup():
    rows = [_row("a", "2026-10-03T17:00:00+00:00")] * 3 + [_row("b", "2026-10-03T17:05:00+00:00")]
    assert _count_events(rows, PARK_TIMEZONE, None, 0, 24) == {"a": 3, "b": 1}


def test_day_is_bucketed_in_park_time_around_local_midnight():
    # 05:59:59Z = Fri 23:59:59 MDT; 06:00:00Z = Sat 00:00:00 MDT. In UTC both
    # are Saturday -- park time must split them.
    before = [_row("a", "2026-10-03T05:59:59+00:00")]
    after = [_row("a", "2026-10-03T06:00:00+00:00")]
    assert _count_events(before, PARK_TIMEZONE, FRIDAY, 0, 24) == {"a": 1}
    assert _count_events(before, PARK_TIMEZONE, SATURDAY, 0, 24) == {}
    assert _count_events(after, PARK_TIMEZONE, SATURDAY, 0, 24) == {"a": 1}
    assert _count_events(after, PARK_TIMEZONE, FRIDAY, 0, 24) == {}


def test_hour_start_inclusive_end_exclusive_in_park_time():
    rows = [
        _row("a", "2026-10-03T16:59:59+00:00"),  # 10:59:59 MDT -> out
        _row("a", "2026-10-03T17:00:00+00:00"),  # 11:00:00 MDT -> in (start inclusive)
        _row("a", "2026-10-03T22:59:59+00:00"),  # 16:59:59 MDT -> in
        _row("a", "2026-10-03T23:00:00+00:00"),  # 17:00:00 MDT -> out (end exclusive)
    ]
    assert _count_events(rows, PARK_TIMEZONE, None, 11, 17) == {"a": 2}


def test_utc_bounds_cover_whole_park_local_days():
    start_utc, end_utc = _utc_bounds(date(2026, 10, 3), date(2026, 10, 4), PARK_TIMEZONE)
    assert start_utc == datetime(2026, 10, 3, 6, 0, tzinfo=timezone.utc)
    assert end_utc == datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc)


def test_utc_bounds_across_dst_changes():
    # Fall-back day is 25 hours long; spring-forward day is 23.
    assert _utc_bounds(date(2025, 11, 2), date(2025, 11, 2), PARK_TIMEZONE) == (
        datetime(2025, 11, 2, 6, 0, tzinfo=timezone.utc),
        datetime(2025, 11, 3, 7, 0, tzinfo=timezone.utc),
    )
    assert _utc_bounds(date(2026, 3, 8), date(2026, 3, 8), PARK_TIMEZONE) == (
        datetime(2026, 3, 8, 7, 0, tzinfo=timezone.utc),
        datetime(2026, 3, 9, 6, 0, tzinfo=timezone.utc),
    )


def test_hour_bucketing_across_fall_back():
    # 01:xx local happens twice on Sun Nov 2 2025: 07:30Z (MDT) and 08:30Z
    # (MST). Both belong to the 1 AM bucket; 09:30Z is 02:30 MST.
    rows = [
        _row("a", "2025-11-02T07:30:00+00:00"),
        _row("a", "2025-11-02T08:30:00+00:00"),
        _row("b", "2025-11-02T09:30:00+00:00"),
    ]
    assert _count_events(rows, PARK_TIMEZONE, SUNDAY, 1, 2) == {"a": 2}
    assert _count_events(rows, PARK_TIMEZONE, SUNDAY, 2, 3) == {"b": 1}


def test_hour_bucketing_across_spring_forward():
    # 08:59:59Z = 01:59:59 MST; 09:00:00Z = 03:00:00 MDT -- 2 AM never exists.
    rows = [_row("a", "2026-03-08T08:59:59+00:00"), _row("b", "2026-03-08T09:00:00+00:00")]
    assert _count_events(rows, PARK_TIMEZONE, SUNDAY, 1, 2) == {"a": 1}
    assert _count_events(rows, PARK_TIMEZONE, SUNDAY, 2, 3) == {}
    assert _count_events(rows, PARK_TIMEZONE, SUNDAY, 3, 4) == {"b": 1}


def test_no_fall_back_in_november_2026():
    # Pins the tzdata fact above: if a tzdata bump ever reintroduces a
    # Nov 2026 fall-back, this fails and the DST tests need revisiting.
    for iso in ("2026-07-01T12:00:00+00:00", "2026-11-15T12:00:00+00:00", "2027-01-15T12:00:00+00:00"):
        offset = datetime.fromisoformat(iso).astimezone(PARK_TIMEZONE).utcoffset()
        assert offset is not None and offset.total_seconds() == -6 * 3600


def test_get_heatmap_date_range_is_park_local_days(events):
    events += [
        _row("a", "2026-10-03T05:59:59+00:00"),  # Fri Oct 2, 23:59:59 park time
        _row("a", "2026-10-03T06:00:00+00:00"),  # Sat Oct 3, 00:00 park time
        _row("a", "2026-10-04T05:59:59+00:00"),  # Sat Oct 3, 23:59:59 park time
        _row("a", "2026-10-04T06:00:00+00:00"),  # Sun Oct 4, 00:00 park time
    ]
    assert _visits(get_heatmap(date(2026, 10, 3), date(2026, 10, 3))) == 2
    assert _visits(get_heatmap(date(2026, 10, 2), date(2026, 10, 2))) == 1
    assert _visits(get_heatmap(date(2026, 10, 2), date(2026, 10, 4))) == 4


def test_get_heatmap_day_and_hour_filters_use_park_time(events):
    # Sat Oct 3 at 11:00 and 16:59 MDT, plus Sun Oct 4 00:30 MDT (06:30Z).
    events += [
        _row("a", "2026-10-03T17:00:00+00:00"),
        _row("a", "2026-10-03T22:59:00+00:00"),
        _row("a", "2026-10-04T06:30:00+00:00"),
    ]
    sat = get_heatmap(date(2026, 10, 1), date(2026, 10, 7), day="saturday", hour_start=11, hour_end=17)
    assert _visits(sat) == 2
    sun = get_heatmap(date(2026, 10, 1), date(2026, 10, 7), day="Sunday", hour_start=0, hour_end=1)
    assert _visits(sun) == 1


def test_get_heatmap_no_longer_accepts_a_timezone():
    with pytest.raises(TypeError):
        get_heatmap(date(2026, 10, 1), date(2026, 10, 2), tz="Asia/Tokyo")  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"day": "funday"},
        {"hour_start": 17, "hour_end": 11},
        {"hour_start": 5, "hour_end": 5},
    ],
)
def test_invalid_filters_raise_before_any_query(kwargs):
    with pytest.raises(HeatmapFilterError):
        get_heatmap(date(2026, 10, 1), date(2026, 10, 2), **kwargs)


def test_end_before_start_rejected():
    with pytest.raises(HeatmapFilterError):
        get_heatmap(date(2026, 10, 2), date(2026, 10, 1))


T = "2026-10-03T17:00:00+00:00"


def test_aggregate_rolls_child_node_events_up_into_the_parent_pin():
    parent_of = {n["id"]: n["parent_node_id"] for n in NODES}
    rows = [
        _row("arcade", T),
        _row("cornhole", T, "qr_scan", ("scoring_game", "cornhole")),
        _row("cornhole", T, "qr_scan", ("scoring_game", "cornhole")),
    ]
    counts, unmapped = heatmap._aggregate(rows, parent_of)
    assert [(c.source_id, c.visits, c.check_ins, c.scans) for c in counts] == [("arcade", 3, 1, 2)]
    assert unmapped == []


def test_aggregate_counts_unmapped_scans_separately():
    rows = [
        _row(None, T, "qr_scan", ("animal", "sloth")),
        _row(None, T, "qr_scan", ("animal", "sloth")),
        _row(None, T, "qr_scan", ("hunt_character", "quick-falcon")),
        _row("goats", T, "qr_scan", ("animal", "goat")),
    ]
    counts, unmapped = heatmap._aggregate(rows, {})
    assert [(c.source_id, c.scans) for c in counts] == [("goats", 1)]
    assert [(u.destination_type, u.destination_id, u.scans) for u in unmapped] == [
        ("animal", "sloth", 2),
        ("hunt_character", "quick-falcon", 1),
    ]


def test_aggregate_survives_a_parent_cycle():
    assert heatmap._top_level("a", {"a": "b", "b": "a"}) in {"a", "b"}


def test_get_heatmap_source_filter(events):
    events += [
        _row("goats", T),
        _row("goats", T, "qr_scan", ("animal", "goat")),
        _row(None, T, "qr_scan", ("animal", "sloth")),
    ]
    day = date(2026, 10, 3)
    both = get_heatmap(day, day)
    assert (both.total_visits, both.unmapped_scans) == (2, 1)
    assert [(c.check_ins, c.scans) for c in both.counts] == [(1, 1)]
    check_ins = get_heatmap(day, day, source=HeatmapSource.CHECK_INS)
    assert (check_ins.total_visits, check_ins.unmapped_scans) == (1, 0)
    scans = get_heatmap(day, day, source=HeatmapSource.QR_SCANS)
    assert (scans.total_visits, scans.unmapped_scans) == (1, 1)


def test_scan_debounce_absorbs_only_near_duplicates(monkeypatch):
    from app.routers import qr_locations as router

    clock = [1000.0]
    monkeypatch.setattr(router.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(router, "_recent_scans", {})
    key = ("session-1", "animal", "goat")
    assert router._is_duplicate(key) is False
    clock[0] += 2
    assert router._is_duplicate(key) is True  # double-fire
    assert router._is_duplicate(("session-1", "animal", "pig")) is False  # different destination
    assert router._is_duplicate(("session-2", "animal", "goat")) is False  # different device
    clock[0] += router.SCAN_DEBOUNCE_SECONDS
    assert router._is_duplicate(key) is False  # a separate, later scan still counts
