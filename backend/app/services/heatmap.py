"""Aggregation for the Staff Visit Heatmap (Phase 1: Map node visits).

Counts raw rows in map_node_visit_events (migration 041) -- every visit
occurrence, never deduplicated -- grouped by source_id, within:

- a [start, end] date range (inclusive, whole days),
- optionally one day of the week,
- optionally an hour window [hour_start, hour_end) (end exclusive, so
  11..17 means 11:00 through 16:59).

All three are interpreted in PARK_TIMEZONE (the park's own wall-clock
time), never the viewer's: "Saturdays 11am-5pm" means park hours, and the
same data must show the same busy times to anyone viewing it from anywhere.
The date range is park-local calendar days.

The date range is narrowed in the DB query (converted to UTC bounds);
day/hour filtering happens in Python per row, since PostgREST can't
extract a local weekday/hour without an RPC -- same "filter by range in
the query, aggregate in Python" convention as app/services/analytics.py.
Volume is a single seasonal park, so no pre-aggregation table.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import HeatmapSourceCount, HeatmapSummary
from app.services.analytics import _fetch_paginated, _parse_timestamptz
from app.supabase_client import get_supabase_client

MAP_NODE_SOURCE_TYPE = "map_node"

# Cobb's Adventure Park is in Alberta (Mountain time, observes DST). The
# frontend's parkSchedule.ts has no explicit zone -- it runs in the browser's
# local time -- so this is the app's only stored park timezone. Resolved
# from the pinned tzdata package, not the host OS.
PARK_TIMEZONE = ZoneInfo("America/Edmonton")

# Python's date.weekday() order (Monday == 0).
DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


class HeatmapFilterError(ValueError):
    pass


def _utc_bounds(start: date, end: date, zone: ZoneInfo | timezone) -> tuple[datetime, datetime]:
    """[local midnight of start, local midnight after end) as UTC instants --
    half-open, so the last instant of `end` is included exactly once."""
    start_utc = datetime.combine(start, time.min, tzinfo=zone).astimezone(timezone.utc)
    end_utc = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    return start_utc, end_utc


def _count_events(
    rows: list[dict], zone: ZoneInfo | timezone, weekday: int | None, hour_lo: int, hour_hi: int
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        local = _parse_timestamptz(row["visited_at"]).astimezone(zone)
        if weekday is not None and local.weekday() != weekday:
            continue
        if not (hour_lo <= local.hour < hour_hi):
            continue
        counts[row["source_id"]] = counts.get(row["source_id"], 0) + 1
    return counts


def get_heatmap(
    start: date,
    end: date,
    *,
    day: str | None = None,
    hour_start: int | None = None,
    hour_end: int | None = None,
    source_type: str = MAP_NODE_SOURCE_TYPE,
) -> HeatmapSummary:
    if end < start:
        raise HeatmapFilterError("end must be on or after start")

    weekday: int | None = None
    if day:
        try:
            weekday = DAYS_OF_WEEK.index(day.lower())
        except ValueError as exc:
            raise HeatmapFilterError(f"Unknown day: {day}") from exc

    # Either bound may be given alone (open-ended on the other side).
    lo = 0 if hour_start is None else hour_start
    hi = 24 if hour_end is None else hour_end
    if not (0 <= lo < hi <= 24):
        raise HeatmapFilterError("hour range must satisfy 0 <= hour_start < hour_end <= 24")

    start_utc, end_utc = _utc_bounds(start, end, PARK_TIMEZONE)

    client = get_supabase_client()
    rows = _fetch_paginated(
        lambda: client.table("map_node_visit_events")
        .select("source_id,visited_at")
        .eq("source_type", source_type)
        .gte("visited_at", start_utc.isoformat())
        .lt("visited_at", end_utc.isoformat())
        .order("visited_at")
    )
    counts = _count_events(rows, PARK_TIMEZONE, weekday, lo, hi)

    return HeatmapSummary(
        source_type=source_type,
        total_visits=sum(counts.values()),
        counts=sorted(
            (HeatmapSourceCount(source_id=sid, visits=n) for sid, n in counts.items()),
            key=lambda c: c.visits,
            reverse=True,
        ),
    )
