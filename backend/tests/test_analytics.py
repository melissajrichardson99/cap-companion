"""Unit tests for the pure aggregation helpers in app.services.analytics --
the ones that take already-fetched rows/dicts and do no I/O of their own, so
they're testable the same way milestone.py's pure math is (no Supabase
client needed). Covers the exact "what did this session achieve" math the
project's own known pitfalls call out (bingo tile-index precision), plus the
Full Completionist AND-across-four-conditions logic."""

from datetime import date

import pytest

from app.services.analytics import _bingo, _engagement, _hunt, _overview

_CHAR_1 = "11111111-1111-1111-1111-111111111111"
_CHAR_2 = "22222222-2222-2222-2222-222222222222"


def test_overview_buckets_sessions_by_day_including_zero_days():
    created_at_by_session = {
        "s1": date(2026, 8, 16),
        "s2": date(2026, 8, 16),
        "s3": date(2026, 8, 18),
    }
    result = _overview(total_users=3, created_at_by_session=created_at_by_session, start=date(2026, 8, 16), end=date(2026, 8, 19))

    by_date = {p.date: p.count for p in result.users_over_time}
    assert by_date == {
        "2026-08-16": 2,
        "2026-08-17": 0,
        "2026-08-18": 1,
        "2026-08-19": 0,
    }
    assert result.total_users == 3


def test_hunt_average_completion_rate_is_partial_progress_not_full_finish():
    characters = [{"id": _CHAR_1, "name": "Ranger"}, {"id": _CHAR_2, "name": "Explorer"}]
    # 2 sessions in cohort: s1 found both characters, s2 found none.
    unlocked_count_by_session = {"s1": 2}
    found_by_character = {_CHAR_1: 1, _CHAR_2: 1}

    result = _hunt(
        cohort_ids=["s1", "s2"],
        total_users=2,
        hunt_character_rows=characters,
        hunt_total_characters=2,
        unlocked_count_by_session=unlocked_count_by_session,
        found_by_character=found_by_character,
    )

    # (2 found / 2 sessions / 2 characters) * 100 = 50%, not "1 of 2 sessions
    # fully finished" (which would also be 50% here by coincidence -- the
    # real distinguishing case is covered by the character_found_rates below).
    assert result.avg_completion_rate_pct == 50.0
    rates = {str(r.character_id): r.found_pct for r in result.character_found_rates}
    assert rates == {_CHAR_1: 50.0, _CHAR_2: 50.0}


def test_bingo_milestone_count_uses_exact_tile_index_math_not_a_raw_tile_count():
    # A full top row (indices 0-4) is exactly one "line" milestone, not five
    # separate achievements -- this is the "exact tile-index math, not
    # approximate shape detection" pitfall from CLAUDE.md.
    completed_indices_by_session = {"s1": {0, 1, 2, 3, 4}}
    windowed_tiles_by_session = {"s1": 5}

    result = _bingo(
        cohort_ids=["s1"],
        total_users=1,
        windowed_tiles_by_session=windowed_tiles_by_session,
        completed_indices_by_session=completed_indices_by_session,
    )

    assert result.avg_tiles_completed == 5.0  # raw count, not a % of the 25-tile board
    assert result.avg_milestones_per_session == 1.0  # one line, not five


def test_bingo_blackout_counts_as_a_single_milestone_alongside_its_lines():
    all_indices = set(range(25))
    completed_indices_by_session = {"s1": all_indices}
    windowed_tiles_by_session = {"s1": 25}

    result = _bingo(
        cohort_ids=["s1"],
        total_users=1,
        windowed_tiles_by_session=windowed_tiles_by_session,
        completed_indices_by_session=completed_indices_by_session,
    )

    # 5 rows + 5 cols + blackout = 11 (the "X" 9-tile diagonal shape is a
    # subset of a full board and doesn't add a 12th distinct milestone here
    # since achieved_milestones treats x/blackout as independent booleans).
    assert result.avg_milestones_per_session == 12.0
    assert result.avg_tiles_completed == 25.0


def test_full_completionist_requires_all_four_conditions():
    completed_indices_by_session = {
        "complete": set(range(25)),
        "missing_map": set(range(25)),
        "missing_bingo": set(),
    }
    hunt_completed_count_by_session = {"complete": 2, "missing_map": 2, "missing_bingo": 2}
    map_exploration_sessions = {"complete", "missing_bingo"}
    passport_sessions = {"complete", "missing_map", "missing_bingo"}
    created_at_by_session = {
        "complete": date(2026, 8, 16),
        "missing_map": date(2026, 8, 16),
        "missing_bingo": date(2026, 8, 16),
    }

    result = _engagement(
        cohort_ids=["complete", "missing_map", "missing_bingo"],
        total_users=3,
        created_at_by_session=created_at_by_session,
        start=date(2026, 8, 16),
        end=date(2026, 8, 16),
        hunt_total_characters=2,
        hunt_completed_count_by_session=hunt_completed_count_by_session,
        completed_indices_by_session=completed_indices_by_session,
        map_exploration_sessions=map_exploration_sessions,
        passport_sessions=passport_sessions,
    )

    # Only "complete" satisfies hunt-complete + blackout + map + passport.
    assert result.full_completionist_rate_pct == pytest.approx(100 / 3)
    assert result.full_completionist_trend[0].date == "2026-08-16"
    assert result.full_completionist_trend[0].pct == pytest.approx(100 / 3)
