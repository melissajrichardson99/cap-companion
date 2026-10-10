"""Aggregation for the Staff Visit Heatmap: Map check-ins (Phase 1) and QR
scans (Phase 2).

Counts raw rows in map_node_visit_events (migrations 041/042) -- every
occurrence, never deduplicated -- per map node, within:

- a [start, end] date range (inclusive, whole days),
- optionally one day of the week,
- optionally an hour window [hour_start, hour_end) (end exclusive, so
  11..17 means 11:00 through 16:59),
- a source: check-ins ('map_node'), QR scans ('qr_scan'), or both.

All three time filters are interpreted in PARK_TIMEZONE (the park's own
wall-clock time), never the viewer's: "Saturdays 11am-5pm" means park hours,
and the same data must show the same busy times to anyone viewing it from
anywhere. The date range is park-local calendar days.

A QR destination may be mapped to a child node (e.g. Cornhole under Arcade
Pad), which has no pin of its own -- counts are rolled up into the top-level
ancestor, the dot the heatmap actually draws. Scans of a destination with no
mapped location (source_id null) are counted separately as "unmapped" so
staff can see the gap rather than losing those scans.

The date range is narrowed in the DB query (converted to UTC bounds);
day/hour filtering happens in Python per row, since PostgREST can't
extract a local weekday/hour without an RPC -- same "filter by range in
the query, aggregate in Python" convention as app/services/analytics.py.
Volume is a single seasonal park, so no pre-aggregation table.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import HeatmapSource, HeatmapSourceCount, HeatmapSummary, HeatmapUnmappedCount
from app.services.analytics import _fetch_paginated, _parse_timestamptz
from app.supabase_client import get_supabase_client

logger = logging.getLogger("app")

MAP_NODE_SOURCE_TYPE = "map_node"
QR_SCAN_SOURCE_TYPE = "qr_scan"

# Cobb's Adventure Park is in Alberta (Mountain time, observes DST). The
# frontend's parkSchedule.ts has no explicit zone -- it runs in the browser's
# local time -- so this is the app's only stored park timezone. Resolved
# from the pinned tzdata package, not the host OS.
PARK_TIMEZONE = ZoneInfo("America/Edmonton")

# Python's date.weekday() order (Monday == 0).
DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


class HeatmapFilterError(ValueError):
    pass


def log_visit_event(
    source_type: str,
    source_id: str | None,
    destination_type: str | None = None,
    destination_id: str | None = None,
) -> None:
    """Insert one anonymous map_node_visit_events row.

    Meant to run as a FastAPI background task (after the guest's response
    has been sent), never inline in a request: analytics logging must not
    delay a guest. Best-effort -- a failed insert is logged and swallowed,
    and by the time it runs the guest's request has already succeeded.
    """
    try:
        row = {"source_type": source_type, "source_id": source_id}
        if destination_type is not None:
            row |= {"destination_type": destination_type, "destination_id": destination_id}
        get_supabase_client().table("map_node_visit_events").insert(row, default_to_null=False).execute()
    except Exception:
        logger.exception("Failed to log map_node_visit_events row (%s %s)", source_type, source_id)


def _utc_bounds(start: date, end: date, zone: ZoneInfo | timezone) -> tuple[datetime, datetime]:
    """[local midnight of start, local midnight after end) as UTC instants --
    half-open, so the last instant of `end` is included exactly once."""
    start_utc = datetime.combine(start, time.min, tzinfo=zone).astimezone(timezone.utc)
    end_utc = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    return start_utc, end_utc


def _in_window(rows: list[dict], zone: ZoneInfo | timezone, weekday: int | None, hour_lo: int, hour_hi: int):
    for row in rows:
        local = _parse_timestamptz(row["visited_at"]).astimezone(zone)
        if weekday is not None and local.weekday() != weekday:
            continue
        if not (hour_lo <= local.hour < hour_hi):
            continue
        yield row


def _count_events(
    rows: list[dict], zone: ZoneInfo | timezone, weekday: int | None, hour_lo: int, hour_hi: int
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in _in_window(rows, zone, weekday, hour_lo, hour_hi):
        counts[row["source_id"]] = counts.get(row["source_id"], 0) + 1
    return counts


def _top_level(node_id: str, parent_of: dict[str, str | None]) -> str:
    """Walks parent_node_id up to the node that renders as a pin. Guarded
    against a (shouldn't-happen) parent cycle."""
    seen = {node_id}
    while (parent := parent_of.get(node_id)) and parent not in seen:
        seen.add(parent)
        node_id = parent
    return node_id


def _aggregate(
    rows: list[dict], parent_of: dict[str, str | None]
) -> tuple[list[HeatmapSourceCount], list[HeatmapUnmappedCount]]:
    """Per top-level node check-in/scan counts, plus unmapped scans per
    destination. Pure, so it's unit-testable without a DB."""
    check_ins: dict[str, int] = {}
    scans: dict[str, int] = {}
    unmapped: dict[tuple[str, str], int] = {}
    for row in rows:
        is_scan = row.get("source_type") == QR_SCAN_SOURCE_TYPE
        if is_scan and row["source_id"] is None:
            key = (row["destination_type"], row["destination_id"])
            unmapped[key] = unmapped.get(key, 0) + 1
            continue
        node = _top_level(row["source_id"], parent_of)
        bucket = scans if is_scan else check_ins
        bucket[node] = bucket.get(node, 0) + 1

    counts = [
        HeatmapSourceCount(
            source_id=node,
            visits=check_ins.get(node, 0) + scans.get(node, 0),
            check_ins=check_ins.get(node, 0),
            scans=scans.get(node, 0),
        )
        for node in check_ins.keys() | scans.keys()
    ]
    counts.sort(key=lambda c: (-c.visits, c.source_id))
    unmapped_counts = sorted(
        (HeatmapUnmappedCount(destination_type=t, destination_id=d, scans=n) for (t, d), n in unmapped.items()),
        key=lambda u: (-u.scans, u.destination_type, u.destination_id),
    )
    return counts, unmapped_counts


def get_heatmap(
    start: date,
    end: date,
    *,
    day: str | None = None,
    hour_start: int | None = None,
    hour_end: int | None = None,
    source: HeatmapSource = HeatmapSource.ALL,
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
    source_types = [MAP_NODE_SOURCE_TYPE, QR_SCAN_SOURCE_TYPE] if source == HeatmapSource.ALL else [source.value]

    client = get_supabase_client()
    rows = _fetch_paginated(
        lambda: client.table("map_node_visit_events")
        .select("source_type,source_id,destination_type,destination_id,visited_at")
        .in_("source_type", source_types)
        .gte("visited_at", start_utc.isoformat())
        .lt("visited_at", end_utc.isoformat())
        .order("visited_at")
    )
    node_rows = client.table("map_nodes").select("id,parent_node_id").execute().data
    parent_of = {n["id"]: n["parent_node_id"] for n in node_rows}

    counts, unmapped = _aggregate(list(_in_window(rows, PARK_TIMEZONE, weekday, lo, hi)), parent_of)

    return HeatmapSummary(
        source=source,
        total_visits=sum(c.visits for c in counts),
        counts=counts,
        unmapped_scans=sum(u.scans for u in unmapped),
        unmapped=unmapped,
    )
