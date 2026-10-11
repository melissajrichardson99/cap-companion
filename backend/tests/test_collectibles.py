"""Unit tests for Collectible Cards' pure catalog/pricing logic (the DB-backed
purchase()/list_cards() paths are covered end to end by
frontend/e2e/collectible-cards.spec.ts instead, same split as test_coins.py)."""

from app.models import CollectibleTier
from app.services.collectibles import (
    COLLECTIBLE_SLUGS,
    PHOTO_POOL_SIZE,
    PRICE_SPECIAL,
    PRICE_STANDARD,
    get_catalog,
    price_for,
    tier_for,
)


def test_catalog_has_one_entry_per_animal_with_no_duplicates():
    catalog = get_catalog()
    assert len(catalog) == len(COLLECTIBLE_SLUGS) == 9
    assert {entry.animal_slug for entry in catalog} == set(COLLECTIBLE_SLUGS)


def test_no_animal_is_special_yet_but_the_tier_is_structurally_supported():
    # Ticket: "no current animal should be flagged special yet -- leave the
    # category structurally supported, not populated."
    for slug in COLLECTIBLE_SLUGS:
        assert tier_for(slug) == CollectibleTier.STANDARD
        assert price_for(slug) == PRICE_STANDARD == 100


def test_special_tier_pricing_is_higher_once_populated():
    # No slug is special today, but the pricing constants themselves must
    # already be in the right order for whenever one is added.
    assert PRICE_SPECIAL == 150
    assert PRICE_SPECIAL > PRICE_STANDARD


def test_photo_pool_size_is_positive():
    assert PHOTO_POOL_SIZE > 0
