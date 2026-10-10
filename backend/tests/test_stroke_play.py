"""Unit tests for stroke-play (mini golf) math and validation -- migration 043."""

import pytest
from pydantic import ValidationError

from app.models import RecordHoleScoreRequest
from app.services.stroke_play import (
    HoleScoreLike,
    STATUS_IN_PROGRESS,
    STATUS_WON,
    can_write,
    compute_totals,
    evaluate,
    next_cell,
    validate_hole,
    validate_strokes,
    winner_text,
)


def _round(players: list[str], holes: dict[str, list[int]]) -> list[HoleScoreLike]:
    """Scores from per-player stroke lists (index 0 = hole 1)."""
    return [HoleScoreLike(p, i + 1, s) for p in players for i, s in enumerate(holes[p])]


# ---------------------------------------------------------------------------
# totals
# ---------------------------------------------------------------------------


def test_totals_zero_init_players_without_scores():
    assert compute_totals([HoleScoreLike("Alex", 1, 3)], ["Alex", "Sam"]) == {"Alex": 3, "Sam": 0}


def test_totals_sum_every_hole():
    scores = _round(["Alex", "Sam"], {"Alex": [3, 4, 2], "Sam": [5, 1, 1]})
    assert compute_totals(scores, ["Alex", "Sam"]) == {"Alex": 9, "Sam": 7}


def test_full_nine_hole_round_lowest_total_wins():
    players = ["Alex", "Sam"]
    scores = _round(players, {"Alex": [3, 4, 2, 5, 3, 2, 4, 3, 3], "Sam": [2, 3, 2, 4, 3, 2, 3, 3, 2]})
    result = evaluate(scores, players, 9)
    assert result.status == STATUS_WON
    assert result.totals == {"Alex": 29, "Sam": 24}
    assert result.leaders == ("Sam",)
    assert result.current_hole is None and result.current_player is None


# ---------------------------------------------------------------------------
# ties
# ---------------------------------------------------------------------------


def test_two_way_tie_is_shared():
    players = ["Alex", "Sam"]
    result = evaluate(_round(players, {"Alex": [3, 4, 2], "Sam": [4, 3, 2]}), players, 3)
    assert result.status == STATUS_WON
    assert result.leaders == ("Alex", "Sam")
    assert winner_text(result.leaders) == "Alex & Sam"


def test_three_way_tie_is_shared_in_player_order():
    players = ["Jo", "Alex", "Sam", "Kim"]
    holes = {"Jo": [2, 2], "Alex": [1, 3], "Sam": [3, 1], "Kim": [5, 5]}
    result = evaluate(_round(players, holes), players, 2)
    assert result.leaders == ("Jo", "Alex", "Sam")
    assert winner_text(result.leaders) == "Jo, Alex & Sam"


def test_winner_text_single_winner():
    assert winner_text(("Alex",)) == "Alex"


# ---------------------------------------------------------------------------
# guided order, leader during play
# ---------------------------------------------------------------------------


def test_next_cell_walks_players_then_holes():
    players = ["Alex", "Sam"]
    assert next_cell([], players, 9) == (1, "Alex")
    assert next_cell([HoleScoreLike("Alex", 1, 3)], players, 9) == (1, "Sam")
    assert next_cell(_round(players, {"Alex": [3], "Sam": [3]}), players, 9) == (2, "Alex")


def test_leader_only_counts_holes_everyone_has_finished():
    players = ["Alex", "Sam"]
    # Both finished hole 1 (Alex 2, Sam 3); Alex has also played hole 2 (5).
    scores = [HoleScoreLike("Alex", 1, 2), HoleScoreLike("Sam", 1, 3), HoleScoreLike("Alex", 2, 5)]
    result = evaluate(scores, players, 9)
    assert result.status == STATUS_IN_PROGRESS
    assert result.totals == {"Alex": 7, "Sam": 3}
    assert result.leaders == ("Alex",)
    assert (result.current_hole, result.current_player) == (2, "Sam")


def test_no_leader_before_the_first_hole_is_finished():
    assert evaluate([HoleScoreLike("Alex", 1, 2)], ["Alex", "Sam"], 9).leaders == ()


def test_twelve_hole_course_needs_all_twelve():
    players = ["Alex"]
    eleven = _round(players, {"Alex": [2] * 11})
    assert evaluate(eleven, players, 12).status == STATUS_IN_PROGRESS
    assert evaluate(_round(players, {"Alex": [2] * 12}), players, 12).status == STATUS_WON


def test_can_write_next_cell_or_a_correction_only():
    players = ["Alex", "Sam"]
    scores = [HoleScoreLike("Alex", 1, 3)]
    assert can_write(scores, players, 9, 1, "Sam")  # next
    assert can_write(scores, players, 9, 1, "Alex")  # correction
    assert not can_write(scores, players, 9, 2, "Alex")  # skipping ahead
    assert not can_write(scores, players, 9, 5, "Sam")


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", [1, 4, 999])
def test_strokes_in_range_are_valid(value):
    assert validate_strokes(value) == value


@pytest.mark.parametrize("value", [0, -1, 1000])
def test_strokes_out_of_range_are_rejected(value):
    with pytest.raises(ValueError):
        validate_strokes(value)


@pytest.mark.parametrize("value", ["4", "04", "four", 4.0, None, True])
def test_strokes_non_integers_are_rejected(value):
    with pytest.raises(ValueError):
        validate_strokes(value)


@pytest.mark.parametrize("hole", [1, 9])
def test_hole_within_count_is_valid(hole):
    assert validate_hole(hole, 9) == hole


@pytest.mark.parametrize("hole", [0, 10, "3", True])
def test_hole_outside_count_is_rejected(hole):
    with pytest.raises(ValueError):
        validate_hole(hole, 9)


@pytest.mark.parametrize("strokes", [1, 999])
def test_request_accepts_valid_strokes(strokes):
    assert RecordHoleScoreRequest(player_name="Alex", hole_number=1, strokes=strokes).strokes == strokes


@pytest.mark.parametrize("strokes", [0, 1000, "4", "04", 4.5, True, None])
def test_request_rejects_invalid_strokes(strokes):
    with pytest.raises(ValidationError):
        RecordHoleScoreRequest(player_name="Alex", hole_number=1, strokes=strokes)


@pytest.mark.parametrize("hole", [0, "1"])
def test_request_rejects_invalid_hole(hole):
    with pytest.raises(ValidationError):
        RecordHoleScoreRequest(player_name="Alex", hole_number=hole, strokes=3)
