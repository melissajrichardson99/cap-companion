"""Unit tests for the unified manual-entry lookup's pure collision-grouping
logic (resolve_manual_entry()/find_cross_type_collisions() themselves are
DB-backed -- covered end to end by scan.spec.ts's "unified scan resolution"
describe block instead, same split as test_collectibles.py)."""

from app.models import ManualEntryMatchType
from app.services.scan import _collisions_among


def test_no_collision_when_every_source_is_distinct():
    sources = {
        ManualEntryMatchType.SCAN: ["brave-otter", "jolly-zebra"],
        ManualEntryMatchType.ANIMAL: ["capybara", "goat"],
        ManualEntryMatchType.SCORING_GAME: ["farm-toss"],
        ManualEntryMatchType.PUZZLE_CHALLENGE: ["math-maze-standard"],
    }
    assert _collisions_among(sources) == {}


def test_detects_a_collision_between_two_sources():
    sources = {
        ManualEntryMatchType.SCAN: ["farm-toss"],
        ManualEntryMatchType.ANIMAL: ["goat"],
        ManualEntryMatchType.SCORING_GAME: ["farm-toss"],
        ManualEntryMatchType.PUZZLE_CHALLENGE: [],
    }
    assert _collisions_among(sources) == {
        "farm-toss": [ManualEntryMatchType.SCAN, ManualEntryMatchType.SCORING_GAME]
    }


def test_detects_a_collision_across_three_sources():
    sources = {
        ManualEntryMatchType.SCAN: ["otter"],
        ManualEntryMatchType.ANIMAL: ["otter"],
        ManualEntryMatchType.SCORING_GAME: ["otter"],
        ManualEntryMatchType.PUZZLE_CHALLENGE: [],
    }
    assert _collisions_among(sources) == {
        "otter": [ManualEntryMatchType.SCAN, ManualEntryMatchType.ANIMAL, ManualEntryMatchType.SCORING_GAME]
    }


def test_a_repeated_value_within_the_same_source_is_not_a_cross_type_collision():
    # scannable_codes/scoring_games.slug/puzzle_challenges.slug are already
    # DB-unique within their own table -- this only guards the grouping logic
    # itself never mistaking a same-source repeat for a cross-type one.
    sources = {
        ManualEntryMatchType.SCAN: ["brave-otter", "brave-otter"],
        ManualEntryMatchType.ANIMAL: [],
        ManualEntryMatchType.SCORING_GAME: [],
        ManualEntryMatchType.PUZZLE_CHALLENGE: [],
    }
    assert _collisions_among(sources) == {"brave-otter": [ManualEntryMatchType.SCAN, ManualEntryMatchType.SCAN]}
