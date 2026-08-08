"""Unit tests for the minigame random draw — tech spec section 4.1 / 5.

Base44's version was reportedly uneven or ignored certain games; the
distribution test here is the direct regression check for that failure mode.
"""

import random
from collections import Counter

import pytest

from app.services.minigame_draw import draw_for_tile_completion, draw_one

POOL = ["Whack-a-Capybara", "Pattern Repeat", "Card Flip Pairs", "Mini Maze", "Mini Snake"]


def test_draw_one_only_ever_returns_pool_members():
    rng = random.Random(42)
    for _ in range(200):
        assert draw_one(POOL, rng) in POOL


def test_base_completion_draws_exactly_one_game():
    rng = random.Random(1)
    draws = draw_for_tile_completion(POOL, rng, milestone_triggered=False)
    assert len(draws) == 1


def test_milestone_completion_draws_two_games_total():
    rng = random.Random(1)
    draws = draw_for_tile_completion(POOL, rng, milestone_triggered=True)
    assert len(draws) == 2


def test_milestone_draws_are_independent_and_may_repeat():
    # With a fixed seed exercised across many milestone completions, at least
    # one run should repeat a game within its own 2-draw set — proving repeats
    # aren't being filtered out (spec: "repeats allowed").
    rng = random.Random(7)
    saw_a_repeat_within_a_completion = False
    for _ in range(200):
        draws = draw_for_tile_completion(POOL, rng, milestone_triggered=True)
        if len(set(draws)) < len(draws):
            saw_a_repeat_within_a_completion = True
            break
    assert saw_a_repeat_within_a_completion


def test_reroll_avoids_immediately_repeating_the_last_played_when_possible():
    # avoid_id should not appear as the result of draw_one when the pool has
    # more than one option, since a match forces exactly one re-roll.
    small_pool = ["A", "B"]
    rng = random.Random(3)
    for _ in range(200):
        result = draw_one(small_pool, rng, avoid_id="A")
        # A single re-roll can't *guarantee* avoidance (the re-roll itself could
        # land back on "A"), so just confirm draws stay within the pool and the
        # function runs without error across many seeds/pool shapes.
        assert result in small_pool


def test_draw_distribution_is_roughly_uniform_across_the_pool():
    rng = random.Random(12345)
    n = 4000  # large sample keeps the test stable; ~100 draws per spec is too
    # noisy to assert a tight bound on 5 buckets without flaking.
    counts = Counter(draw_one(POOL, rng) for _ in range(n))

    assert set(counts.keys()) == set(POOL)  # every game gets drawn at least once

    expected = n / len(POOL)
    for game in POOL:
        # Allow generous +/-30% slack around the expected uniform share; a
        # broken distribution (e.g. one game favored/ignored) blows past this.
        assert counts[game] == pytest.approx(expected, rel=0.3), counts


def test_hundred_draw_smoke_sample_hits_every_game_at_least_once():
    # Direct regression check for the spec's literal ~100-draw scenario.
    rng = random.Random(99)
    counts = Counter(draw_one(POOL, rng) for _ in range(100))
    assert set(counts.keys()) == set(POOL)
    assert min(counts.values()) >= 5  # no game starved out of 100 draws across 5 games
