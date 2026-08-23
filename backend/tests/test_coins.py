"""Unit tests for Cobb Coins' pure scaling logic: puzzle-timer hint scaling
and bingo milestone-tier amounts."""

from app.services.coins import (
    BINGO_BLACKOUT_AMOUNT,
    BINGO_LINE_AMOUNT,
    BINGO_X_DOUBLE_AMOUNT,
    bingo_milestone_amount,
    puzzle_timer_amount,
)


def test_fewer_hints_used_earns_strictly_more_coins():
    amounts = [puzzle_timer_amount(n) for n in (0, 1, 2, 3)]
    assert amounts == sorted(amounts, reverse=True)
    assert len(set(amounts)) == 4


def test_every_hint_tier_still_earns_a_positive_amount():
    for hints_used in (0, 1, 2, 3):
        assert puzzle_timer_amount(hints_used) > 0


def test_bingo_milestone_amounts_match_the_documented_tiers():
    assert bingo_milestone_amount("line") == BINGO_LINE_AMOUNT == 10
    assert bingo_milestone_amount("x") == BINGO_X_DOUBLE_AMOUNT == 25
    assert bingo_milestone_amount("double_bingo") == BINGO_X_DOUBLE_AMOUNT == 25
    assert bingo_milestone_amount("blackout") == BINGO_BLACKOUT_AMOUNT == 50


def test_bingo_milestone_tiers_are_never_worth_less_at_a_higher_priority():
    # Mirrors milestone.select_display_milestone's priority order (blackout
    # > x > double_bingo > line) -- a higher-priority tier must never pay out
    # less than a lower one, or the coin award and the displayed banner
    # could end up telling contradictory stories about which tier "won".
    assert bingo_milestone_amount("blackout") > bingo_milestone_amount("x")
    assert bingo_milestone_amount("x") == bingo_milestone_amount("double_bingo")
    assert bingo_milestone_amount("double_bingo") > bingo_milestone_amount("line")
