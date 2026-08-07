"""Unit tests for the Cobb Coins puzzle-timer scaling -- fewer hints, more coins."""

from app.services.coins import puzzle_timer_amount


def test_fewer_hints_used_earns_strictly_more_coins():
    amounts = [puzzle_timer_amount(n) for n in (0, 1, 2, 3)]
    assert amounts == sorted(amounts, reverse=True)
    assert len(set(amounts)) == 4


def test_every_hint_tier_still_earns_a_positive_amount():
    for hints_used in (0, 1, 2, 3):
        assert puzzle_timer_amount(hints_used) > 0
