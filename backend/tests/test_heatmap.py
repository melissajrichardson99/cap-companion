"""Unit tests for the Staff Visit Heatmap's pure filter math
(app.services.heatmap) -- timezone-local day/hour bucketing and the UTC
date-range bounds. No Supabase client needed."""

from datetime import date, datetime, timezone

import pytest

from app.services.heatmap import (
    HeatmapFilterError,
    _count_events,
    _utc_bounds,
    get_heatmap,
    resolve_timezone,
)

CHICAGO = resolve_timezone("America/Chicago")


def _row(source_id: str, iso: str) -> dict:
    return {"source_id": source_id, "visited_at": iso}


def test_counts_every_occurrence_without_dedup():
    rows = [_row("a", "2026-10-03T17:00:00+00:00")] * 3 + [_row("b", "2026-10-03T17:05:00+00:00")]
    assert _count_events(rows, timezone.utc, None, 0, 24) == {"a": 3, "b": 1}


def test_day_and_hour_are_bucketed_in_local_time_not_utc():
    # 2026-10-04T02:30Z is Saturday 21:30 in Chicago (CDT, UTC-5) but Sunday
    # 02:30 in UTC -- a Saturday-evening filter must catch it.
    rows = [_row("a", "2026-10-04T02:30:00+00:00")]
    saturday = 5
    assert _count_events(rows, CHICAGO, saturday, 21, 22) == {"a": 1}
    assert _count_events(rows, CHICAGO, saturday + 1, 0, 24) == {}
    assert _count_events(rows, timezone.utc, saturday + 1, 2, 3) == {"a": 1}


def test_hour_end_is_exclusive():
    rows = [_row("a", "2026-10-03T16:59:59+00:00"), _row("a", "2026-10-03T17:00:00+00:00")]
    assert _count_events(rows, timezone.utc, None, 11, 17) == {"a": 1}


def test_utc_bounds_cover_whole_local_days():
    start_utc, end_utc = _utc_bounds(date(2026, 10, 3), date(2026, 10, 4), CHICAGO)
    assert start_utc == datetime(2026, 10, 3, 5, 0, tzinfo=timezone.utc)
    assert end_utc == datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"day": "funday"},
        {"hour_start": 17, "hour_end": 11},
        {"hour_start": 5, "hour_end": 5},
        {"tz": "Not/AZone"},
    ],
)
def test_invalid_filters_raise_before_any_query(kwargs):
    with pytest.raises(HeatmapFilterError):
        get_heatmap(date(2026, 10, 1), date(2026, 10, 2), **kwargs)


def test_end_before_start_rejected():
    with pytest.raises(HeatmapFilterError):
        get_heatmap(date(2026, 10, 2), date(2026, 10, 1))
