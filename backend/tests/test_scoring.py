"""Unit tests for the Scoring Sheet win-condition math — Plan.md 2.2."""

from app.services.scoring import (
    ScoreEntryLike,
    compute_totals,
    evaluate_win,
)


def _entries(*pairs: tuple[str, int]) -> list[ScoreEntryLike]:
    return [ScoreEntryLike(player_name=name, point_value=points) for name, points in pairs]


# ---------------------------------------------------------------------------
# compute_totals
# ---------------------------------------------------------------------------


def test_compute_totals_zero_inits_players_with_no_entries_yet():
    totals = compute_totals(_entries(("Alice", 3)), players=["Alice", "Bob"])
    assert totals == {"Alice": 3, "Bob": 0}


def test_compute_totals_sums_multiple_entries_per_player():
    totals = compute_totals(_entries(("Alice", 2), ("Bob", 3), ("Alice", 6)), players=["Alice", "Bob"])
    assert totals == {"Alice": 8, "Bob": 3}


# ---------------------------------------------------------------------------
# first_to (Farm Toss / Cornhole / Cornhole Extreme)
# ---------------------------------------------------------------------------


def test_first_to_wins_on_exact_threshold():
    entries = _entries(("Alice", 6), ("Alice", 6), ("Alice", 6), ("Alice", 3))  # 21 exactly
    result = evaluate_win(win_condition_type="first_to", entries=entries, players=["Alice", "Bob"], threshold=21)
    assert result.status == "won"
    assert result.winner == "Alice"
    assert result.totals == {"Alice": 21, "Bob": 0}


def test_first_to_wins_on_overshoot_past_threshold():
    # Jumping from 18 straight to 24 (a 6-point ring) still counts as
    # "first to 21" -- you don't need to land exactly on the number.
    entries = _entries(("Alice", 6), ("Alice", 6), ("Alice", 6), ("Alice", 6))  # 24, crosses 21 on the last throw
    result = evaluate_win(win_condition_type="first_to", entries=entries, players=["Alice", "Bob"], threshold=21)
    assert result.status == "won"
    assert result.winner == "Alice"
    assert result.totals["Alice"] == 24


def test_first_to_declares_whoever_crosses_the_threshold_first_in_time_order():
    entries = _entries(("Bob", 20), ("Alice", 21), ("Bob", 1))  # Alice crosses first even though Bob was closer
    result = evaluate_win(win_condition_type="first_to", entries=entries, players=["Alice", "Bob"], threshold=21)
    assert result.status == "won"
    assert result.winner == "Alice"


def test_first_to_stays_in_progress_below_threshold():
    entries = _entries(("Alice", 6), ("Bob", 3))
    result = evaluate_win(win_condition_type="first_to", entries=entries, players=["Alice", "Bob"], threshold=21)
    assert result.status == "in_progress"
    assert result.winner is None
    assert result.totals == {"Alice": 6, "Bob": 3}


# ---------------------------------------------------------------------------
# first_to_bonus_round (Horse Hoops)
# ---------------------------------------------------------------------------


def test_bonus_round_immediate_win_when_sole_leader_crosses_threshold():
    entries = _entries(("Alice", 4), ("Alice", 4), ("Alice", 2), ("Bob", 1))  # Alice=10, Bob=1
    result = evaluate_win(
        win_condition_type="first_to_bonus_round", entries=entries, players=["Alice", "Bob"], threshold=10
    )
    assert result.status == "won"
    assert result.winner == "Alice"


def test_bonus_round_triggers_on_tie_at_threshold_instead_of_declaring_a_winner():
    # Alice and Bob both reach exactly 10 -- no winner yet, bonus round.
    entries = _entries(("Alice", 4), ("Alice", 4), ("Alice", 2), ("Bob", 4), ("Bob", 4), ("Bob", 2))
    result = evaluate_win(
        win_condition_type="first_to_bonus_round", entries=entries, players=["Alice", "Bob"], threshold=10
    )
    assert result.status == "tie_bonus_round"
    assert result.winner is None
    assert set(result.tied_players) == {"Alice", "Bob"}
    assert result.totals == {"Alice": 10, "Bob": 10}


def test_bonus_round_next_score_after_tie_wins_outright_sudden_death():
    tie_entries = _entries(("Alice", 4), ("Alice", 4), ("Alice", 2), ("Bob", 4), ("Bob", 4), ("Bob", 2))
    sudden_death_entry = _entries(("Bob", 1))[0]  # any point value breaks the tie in the bonus round
    result = evaluate_win(
        win_condition_type="first_to_bonus_round",
        entries=[*tie_entries, sudden_death_entry],
        players=["Alice", "Bob"],
        threshold=10,
    )
    assert result.status == "won"
    assert result.winner == "Bob"
    assert result.totals == {"Alice": 10, "Bob": 11}


def test_bonus_round_stays_tied_if_both_teams_score_the_same_again():
    entries = _entries(
        ("Alice", 4), ("Alice", 4), ("Alice", 2), ("Bob", 4), ("Bob", 4), ("Bob", 2),  # tie at 10
        ("Alice", 1), ("Bob", 1),  # both score again, still tied at 11
    )
    result = evaluate_win(
        win_condition_type="first_to_bonus_round", entries=entries, players=["Alice", "Bob"], threshold=10
    )
    assert result.status == "tie_bonus_round"
    assert result.totals == {"Alice": 11, "Bob": 11}


def test_bonus_round_does_not_fire_when_only_one_team_has_reached_threshold():
    # Alice hits 10 outright while Bob is still below -- immediate win, no
    # need to wait for a tie that will never happen.
    entries = _entries(("Alice", 4), ("Alice", 4), ("Alice", 2), ("Bob", 8))
    result = evaluate_win(
        win_condition_type="first_to_bonus_round", entries=entries, players=["Alice", "Bob"], threshold=10
    )
    assert result.status == "won"
    assert result.winner == "Alice"


# ---------------------------------------------------------------------------
# first_to_round_tiebreak (Tiki Toss / Ring & Hook)
# ---------------------------------------------------------------------------


def _round_of_tings(player: str, n: int, per_throw: int = 10) -> list[tuple[str, int]]:
    return [(player, per_throw) for _ in range(n)]


def test_round_tiebreak_does_not_win_mid_round_even_past_threshold():
    # Alice reaches 100 after only 9 of her 10 throws for the round --
    # win condition must wait for the round boundary, not fire early.
    entries = _entries(*[("Alice", 12) for _ in range(9)], ("Bob", 1))  # Alice at 108 after 9 throws
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=entries,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "in_progress"


def test_round_tiebreak_single_leader_at_round_boundary_wins():
    alice_round_1 = _entries(*[("Alice", 12) for _ in range(10)])  # 120 after round 1
    bob_round_1 = _entries(*[("Bob", 5) for _ in range(10)])  # 50 after round 1
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=alice_round_1 + bob_round_1,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "won"
    assert result.winner == "Alice"
    assert result.round_number == 1


def test_round_tiebreak_multiway_tie_at_round_boundary_stays_pending():
    # Three players all cross 100 in the same round, all tied -- no winner
    # yet, the game continues into another round per the confirmed rule
    # ("ties play until someone wins a round").
    alice = _entries(*[("Alice", 10) for _ in range(10)])  # 100
    bob = _entries(*[("Bob", 10) for _ in range(10)])  # 100
    cara = _entries(*[("Cara", 10) for _ in range(10)])  # 100
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=alice + bob + cara,
        players=["Alice", "Bob", "Cara"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "tie_round_pending"
    assert set(result.tied_players) == {"Alice", "Bob", "Cara"}
    assert result.round_number == 1


def test_round_tiebreak_highest_of_multiple_qualifiers_wins_even_if_not_only_one_past_threshold():
    # Both Alice and Bob clear 100 in round 1, but Bob's total is strictly
    # higher -- Bob wins outright, no tie (per "highest score wins if
    # multiple reach 100 same round").
    alice = _entries(*[("Alice", 10) for _ in range(10)])  # 100
    bob = _entries(*[("Bob", 11) for _ in range(10)])  # 110
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=alice + bob,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "won"
    assert result.winner == "Bob"


def test_round_tiebreak_resolves_in_a_later_round_after_a_tie():
    # Round 1: Alice and Bob tie at 100 -- pending. Round 2: Alice pulls
    # ahead -- she wins the tiebreak round, game over.
    alice_r1 = _entries(*[("Alice", 10) for _ in range(10)])  # 100
    bob_r1 = _entries(*[("Bob", 10) for _ in range(10)])  # 100
    alice_r2 = _entries(*[("Alice", 5) for _ in range(10)])  # 150
    bob_r2 = _entries(*[("Bob", 3) for _ in range(10)])  # 130
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=alice_r1 + bob_r1 + alice_r2 + bob_r2,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "won"
    assert result.winner == "Alice"
    assert result.round_number == 2


def test_round_tiebreak_stays_tied_if_the_tiebreak_round_ties_again():
    alice_r1 = _entries(*[("Alice", 10) for _ in range(10)])  # 100
    bob_r1 = _entries(*[("Bob", 10) for _ in range(10)])  # 100
    alice_r2 = _entries(*[("Alice", 5) for _ in range(10)])  # 150
    bob_r2 = _entries(*[("Bob", 5) for _ in range(10)])  # 150
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=alice_r1 + bob_r1 + alice_r2 + bob_r2,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "tie_round_pending"
    assert set(result.tied_players) == {"Alice", "Bob"}
    assert result.round_number == 2


def test_round_tiebreak_waits_for_every_player_to_complete_the_round():
    # Alice has thrown a full round (100+) but Bob hasn't taken all 10
    # throws yet -- can't judge "same round" until Bob catches up.
    alice_r1 = _entries(*[("Alice", 10) for _ in range(10)])  # 100, full round
    bob_partial = _entries(*[("Bob", 10) for _ in range(5)])  # only 5 throws so far
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=alice_r1 + bob_partial,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "in_progress"
    assert result.round_number == 0


def test_round_tiebreak_in_progress_below_threshold_reports_live_totals():
    entries = _entries(*[("Alice", 1) for _ in range(10)], *[("Bob", 1) for _ in range(10)])
    result = evaluate_win(
        win_condition_type="first_to_round_tiebreak",
        entries=entries,
        players=["Alice", "Bob"],
        threshold=100,
        throws_per_round=10,
    )
    assert result.status == "in_progress"
    assert result.totals == {"Alice": 10, "Bob": 10}
    assert result.round_number == 1
