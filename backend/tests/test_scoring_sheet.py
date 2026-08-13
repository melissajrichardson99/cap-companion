"""Unit tests for the turn-cycle math in the Scoring Sheet redesign.

_current_turn is pure (no I/O) despite living in the DB-orchestration
module, so it's tested directly here rather than through the Supabase-backed
service functions -- same pattern as test_passport.py's _pick_title.
"""

from app.services.scoring import ScoreEntryLike
from app.services.scoring_sheet import _current_turn


def _entries(*names: str) -> list[ScoreEntryLike]:
    return [ScoreEntryLike(player_name=n, point_value=1) for n in names]


def test_first_turn_is_first_player_round_one():
    player, round_ = _current_turn([], players=["Alice", "Bob", "Carl"])
    assert player == "Alice"
    assert round_ == 1


def test_advances_to_next_player_within_the_same_round():
    player, round_ = _current_turn(_entries("Alice"), players=["Alice", "Bob", "Carl"])
    assert player == "Bob"
    assert round_ == 1


def test_wraps_to_first_player_on_a_new_round_after_everyone_has_gone():
    player, round_ = _current_turn(_entries("Alice", "Bob", "Carl"), players=["Alice", "Bob", "Carl"])
    assert player == "Alice"
    assert round_ == 2


def test_round_keeps_advancing_across_many_cycles():
    # 7 full rounds (21 entries) for 3 players -> round 8, back to the first player.
    entries = _entries(*(["Alice", "Bob", "Carl"] * 7))
    player, round_ = _current_turn(entries, players=["Alice", "Bob", "Carl"])
    assert player == "Alice"
    assert round_ == 8


def test_single_player_always_stays_on_that_player():
    player, round_ = _current_turn(_entries("Alice", "Alice", "Alice"), players=["Alice"])
    assert player == "Alice"
    assert round_ == 4
