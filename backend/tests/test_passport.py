"""Unit tests for the Family Passport title-selection logic (pure, no DB)."""

from app.services.passport import _pick_title


def test_no_activity_gets_the_generic_fallback_title():
    assert _pick_title(hunt=0, bingo=0, puzzle=0, scoring=0) == "Cobb's Adventure Family"


def test_strongest_single_category_wins_its_title():
    assert _pick_title(hunt=5, bingo=0, puzzle=0, scoring=0) == "Wildlife Explorers"
    assert _pick_title(hunt=0, bingo=25, puzzle=0, scoring=0) == "Bingo All-Stars"
    assert _pick_title(hunt=0, bingo=0, puzzle=9, scoring=0) == "Maze Masters"
    assert _pick_title(hunt=0, bingo=0, puzzle=0, scoring=3) == "Sharpshooter Family"


def test_strong_across_three_or_more_categories_gets_the_all_rounder_title():
    # 4/5, 20/25, 6/9, 2/3 -- all comfortably above the 60% "strong" bar.
    assert _pick_title(hunt=4, bingo=20, puzzle=6, scoring=2) == "Cobb's All-Star Family"


def test_two_strong_categories_still_pick_the_single_strongest_not_all_rounder():
    # Only 2 categories clear the "strong" bar, so the all-rounder title
    # shouldn't fire yet -- the single strongest (bingo, 100%) should win.
    assert _pick_title(hunt=0, bingo=25, puzzle=6, scoring=0) == "Bingo All-Stars"


def test_scoring_wins_beyond_the_reference_count_dont_overweight_it():
    # Scoring has no natural ceiling (a family can win the same game
    # repeatedly), so strength is capped at 1.0 past the reference count --
    # 10 wins scores the same as 3 (both "fully strong"), never more.
    assert _pick_title(hunt=0, bingo=0, puzzle=0, scoring=10) == _pick_title(
        hunt=0, bingo=0, puzzle=0, scoring=3
    )
    # A tie between a fully-complete hunt (5/5) and an over-the-cap scoring
    # count breaks toward hunt (the tie-break priority order) -- confirming
    # scoring's capped strength never exceeds 1.0 and jumps ahead instead.
    assert _pick_title(hunt=5, bingo=0, puzzle=0, scoring=10) == "Wildlife Explorers"
