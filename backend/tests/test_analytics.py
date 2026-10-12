"""Unit tests for the pure aggregation helpers in app.services.analytics --
the ones that turn analytics_summary()'s payload into the response models
and do no I/O of their own, so they're testable the same way milestone.py's
pure math is (no Supabase client needed). Covers the exact "what did this
session achieve" math the project's own known pitfalls call out (bingo
tile-index precision, now via the per-session bitmask), the Full
Completionist AND-across-four-conditions logic, and the visible failure when
migration 044 hasn't been run."""

from datetime import date

import pytest
from postgrest.exceptions import APIError

from app.services import analytics
from app.services.analytics import _bingo, _engagement, _hunt, _mask_indices, _overview, build_summary

_CHAR_1 = "11111111-1111-1111-1111-111111111111"
_CHAR_2 = "22222222-2222-2222-2222-222222222222"
_NODE_1 = "33333333-3333-3333-3333-333333333333"
_NODE_2 = "44444444-4444-4444-4444-444444444444"


def _mask(indices) -> int:
    return sum(1 << i for i in indices)


def _session(indices, *, windowed=None, day="2026-08-16", hunt_completed=0, map_exploration=False, passport=False):
    indices = set(indices)
    return {
        "created_day": day,
        "mask": _mask(indices),
        "windowed_tiles": len(indices) if windowed is None else windowed,
        "hunt_completed": hunt_completed,
        "map_exploration": map_exploration,
        "passport": passport,
    }


# --- bitmask -----------------------------------------------------------------


def test_mask_indices_round_trips_every_tile_index():
    assert _mask_indices(0) == set()
    assert _mask_indices(1) == {0}
    assert _mask_indices(1 << 24) == {24}
    assert _mask_indices(_mask(range(25))) == set(range(25))
    # Tile index = row_index * 5 + col_index, matching the SQL bit position.
    assert _mask_indices(_mask({2 * 5 + 3, 4 * 5 + 0})) == {13, 20}


def test_mask_indices_ignores_bits_beyond_the_25_tile_board():
    assert _mask_indices(1 << 25 | 1 << 3) == {3}


def test_x_shape_from_a_bitmask_is_one_milestone_not_two_diagonals():
    x_shape = {0, 6, 12, 18, 24, 4, 8, 16, 20}
    result = _bingo(total_users=1, bingo_sessions=[_session(x_shape)])
    assert result.avg_milestones_per_session == 1.0


# --- sections ------------------------------------------------------------------


def test_overview_buckets_sessions_by_day_including_zero_days():
    users_by_day = {date(2026, 8, 16): 2, date(2026, 8, 18): 1}
    result = _overview(total_users=3, users_by_day=users_by_day, start=date(2026, 8, 16), end=date(2026, 8, 19))

    by_date = {p.date: p.count for p in result.users_over_time}
    assert by_date == {
        "2026-08-16": 2,
        "2026-08-17": 0,
        "2026-08-18": 1,
        "2026-08-19": 0,
    }
    assert result.total_users == 3


def test_hunt_average_completion_rate_is_partial_progress_not_full_finish():
    # 2 sessions in cohort: s1 found both characters, s2 found none.
    characters = [
        {"id": _CHAR_1, "name": "Ranger", "found": 1},
        {"id": _CHAR_2, "name": "Explorer", "found": 1},
    ]

    result = _hunt(total_users=2, hunt_characters=characters, total_unlocked=2)

    # (2 found / 2 sessions / 2 characters) * 100 = 50%, not "1 of 2 sessions
    # fully finished" (which would also be 50% here by coincidence -- the
    # real distinguishing case is covered by the character_found_rates below).
    assert result.avg_completion_rate_pct == 50.0
    rates = {str(r.character_id): r.found_pct for r in result.character_found_rates}
    assert rates == {_CHAR_1: 50.0, _CHAR_2: 50.0}
    # Order is the function's (sort_order), not re-sorted here.
    assert [r.name for r in result.character_found_rates] == ["Ranger", "Explorer"]


def test_bingo_milestone_count_uses_exact_tile_index_math_not_a_raw_tile_count():
    # A full top row (indices 0-4) is exactly one "line" milestone, not five
    # separate achievements -- this is the "exact tile-index math, not
    # approximate shape detection" pitfall from CLAUDE.md.
    result = _bingo(total_users=1, bingo_sessions=[_session({0, 1, 2, 3, 4})])

    assert result.avg_tiles_completed == 5.0  # raw count, not a % of the 25-tile board
    assert result.avg_milestones_per_session == 1.0  # one line, not five


def test_bingo_blackout_counts_as_a_single_milestone_alongside_its_lines():
    result = _bingo(total_users=1, bingo_sessions=[_session(range(25))])

    # 5 rows + 5 cols + X + blackout = 12 (achieved_milestones treats x and
    # blackout as independent booleans).
    assert result.avg_milestones_per_session == 12.0
    assert result.avg_tiles_completed == 25.0


def test_bingo_averages_over_every_cohort_session_not_just_listed_ones():
    # 4 users, only one has completions (and only 3 of its 5 in the window):
    # the function omits sessions with no completions, which must still
    # count in the denominator.
    result = _bingo(total_users=4, bingo_sessions=[_session({0, 1, 2, 3, 4}, windowed=3)])

    assert result.avg_tiles_completed == 0.75
    assert result.avg_milestones_per_session == 0.25


def test_full_completionist_requires_all_four_conditions():
    sessions = [
        _session(range(25), hunt_completed=2, map_exploration=True, passport=True),  # complete
        _session(range(25), hunt_completed=2, map_exploration=False, passport=True),  # missing map
        _session(range(24), hunt_completed=2, map_exploration=True, passport=True),  # missing blackout
        _session(range(25), hunt_completed=1, map_exploration=True, passport=True),  # missing hunt
        _session(range(25), hunt_completed=2, map_exploration=True, passport=False),  # missing passport
    ]

    result = _engagement(
        total_users=6,
        users_by_day={date(2026, 8, 16): 6},
        bingo_sessions=sessions,
        hunt_total_characters=2,
        start=date(2026, 8, 16),
        end=date(2026, 8, 16),
    )

    # Only the first satisfies hunt-complete + blackout + map + passport.
    assert result.full_completionist_rate_pct == pytest.approx(100 / 6)
    assert result.full_completionist_trend[0].date == "2026-08-16"
    assert result.full_completionist_trend[0].pct == pytest.approx(100 / 6)


def test_full_completionist_is_impossible_with_no_hunt_characters():
    session = _session(range(25), hunt_completed=0, map_exploration=True, passport=True)
    result = _engagement(1, {date(2026, 8, 16): 1}, [session], 0, date(2026, 8, 16), date(2026, 8, 16))
    assert result.full_completionist_rate_pct == 0.0


# --- whole payload -------------------------------------------------------------


def _payload(**overrides) -> dict:
    payload = {
        "total_users": 4,
        "users_by_day": [{"day": "2026-08-16", "count": 3}, {"day": "2026-08-17", "count": 1}],
        "coins_total": 120,
        "hunt_characters": [{"id": _CHAR_1, "name": "Ranger", "found": 2}, {"id": _CHAR_2, "name": "Explorer", "found": 1}],
        "hunt_total_unlocked": 3,
        "bingo_sessions": [_session(range(25), hunt_completed=2, map_exploration=True, passport=True)],
        "cohort_node_visits": 10,
        "node_rankings": [
            {"node_id": _NODE_1, "name": "Goats", "visits": 2},
            {"node_id": _NODE_2, "name": "Unknown", "visits": 5},
        ],
        "collectibles": [{"animal_slug": "goat", "count": 1}, {"animal_slug": "pig", "count": 3}],
        "puzzle_timer_solves": 7,
        "scoring_sheet_attempts": 6,
        "scoring_sheet_completions": 5,
        "photos_submitted": 2,
        "voting_cohort_sessions": 1,
        "passports_generated": 1,
        "staff_requests_total": 3,
        "staff_requests_question": 2,
        "staff_requests_emergency": 1,
    }
    payload.update(overrides)
    return payload


def test_build_summary_maps_every_payload_field():
    s = build_summary(date(2026, 8, 16), date(2026, 8, 17), _payload())

    assert (s.range_start, s.range_end) == ("2026-08-16", "2026-08-17")
    assert s.overview.total_users == 4
    assert [(p.date, p.count) for p in s.overview.users_over_time] == [("2026-08-16", 3), ("2026-08-17", 1)]
    assert (s.coins.total_coins_earned, s.coins.avg_coins_per_user) == (120, 30.0)
    assert s.hunt.avg_completion_rate_pct == 3 / 4 / 2 * 100
    assert [r.found_pct for r in s.hunt.character_found_rates] == [50.0, 25.0]
    assert s.bingo.avg_tiles_completed == 25 / 4
    assert s.bingo.avg_milestones_per_session == 12 / 4
    assert s.map_exploration.avg_nodes_visited_per_session == 2.5
    assert [(r.name, r.visits) for r in s.map_exploration.node_rankings] == [("Unknown", 5), ("Goats", 2)]
    assert [(r.animal_slug, r.count) for r in s.collectibles.most_purchased] == [("pig", 3), ("goat", 1)]
    assert (s.puzzle_scoring.puzzle_timer_solves, s.puzzle_scoring.scoring_sheet_attempts, s.puzzle_scoring.scoring_sheet_completions) == (7, 6, 5)
    assert (s.photos_passport.photos_submitted, s.photos_passport.pct_sessions_voting, s.photos_passport.passports_generated) == (2, 25.0, 1)
    assert s.engagement.full_completionist_rate_pct == 25.0
    assert [p.pct for p in s.engagement.full_completionist_trend] == [pytest.approx(100 / 3), 0.0]
    assert (s.staff_ops.total_requests, s.staff_ops.general_count, s.staff_ops.emergency_count) == (3, 2, 1)


def test_build_summary_with_no_sessions_is_all_zero_not_a_division_error():
    s = build_summary(
        date(2020, 1, 1),
        date(2020, 1, 2),
        _payload(total_users=0, users_by_day=[], bingo_sessions=[], hunt_total_unlocked=0, cohort_node_visits=0, voting_cohort_sessions=0),
    )
    assert s.overview.total_users == 0
    assert s.coins.avg_coins_per_user == 0.0
    assert s.hunt.avg_completion_rate_pct == 0.0
    assert s.bingo.avg_tiles_completed == 0.0
    assert s.engagement.full_completionist_rate_pct == 0.0


# --- deploy-order failure ------------------------------------------------------


class _FakeRpc:
    def __init__(self, result=None, error=None):
        self._result, self._error = result, error
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return self

    def execute(self):
        if self._error:
            raise self._error

        class _Resp:
            data = self._result

        return _Resp()


def test_get_summary_makes_one_rpc_call_with_the_utc_day_bounds(monkeypatch):
    fake = _FakeRpc(result=_payload())
    monkeypatch.setattr(analytics, "get_supabase_client", lambda: fake)

    analytics.get_summary(date(2026, 8, 16), date(2026, 8, 17))

    assert fake.calls == [
        (
            "analytics_summary",
            {"p_start": "2026-08-16T00:00:00+00:00", "p_end": "2026-08-17T23:59:59.999999+00:00"},
        )
    ]


def test_missing_function_fails_loudly_naming_the_migration(monkeypatch):
    fake = _FakeRpc(error=APIError({"code": "PGRST202", "message": "Could not find the function"}))
    monkeypatch.setattr(analytics, "get_supabase_client", lambda: fake)

    with pytest.raises(analytics.AnalyticsFunctionMissing, match="044_analytics_summary_rpc.sql"):
        analytics.get_summary(date(2026, 8, 16), date(2026, 8, 17))


def test_unexpected_payload_fails_loudly_instead_of_showing_zeros(monkeypatch):
    monkeypatch.setattr(analytics, "get_supabase_client", lambda: _FakeRpc(result=None))
    with pytest.raises(RuntimeError, match="unexpected payload"):
        analytics.get_summary(date(2026, 8, 16), date(2026, 8, 17))
