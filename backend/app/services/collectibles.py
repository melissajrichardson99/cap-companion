"""Orchestration for the Collectible Cards shop (Cobb Coins' spend side).

collectible_redemptions is an append-only spend ledger, sibling to
coin_awards (app/services/coins.py) -- kept as a separate table rather than
negative-amount rows in coin_awards because that table's `amount > 0` CHECK
is what keeps the earn side honest. Each row doubles as both the spend
record AND a gallery item: animal, tier, which curated photo it rolled, and
whose name it was collected under -- see app/routers/collectibles.py.

The animal roster itself has no backend table (same as the frontend's
ANIMALS constant in animalContent.ts -- this is a POC with no admin UI for
either); ANIMAL_SLUGS below is this module's own copy of that same 9-slug
list, used only to validate purchase requests and price them. Pricing/tier
are backend-owned so the frontend never hardcodes them -- it fetches
get_catalog() instead.
"""

from __future__ import annotations

import random
from datetime import datetime
from uuid import UUID

from app.errors import ConflictError, NotFoundError
from app.models import CollectibleCard, CollectibleCatalogEntry, CollectibleTier
from app.services import coins as coins_service
from app.supabase_client import get_supabase_client

ANIMAL_SLUGS = ["capybara", "kangaroo", "alpaca", "emu", "wallaby", "goat", "sloth", "porcupine", "pig"]

PRICE_STANDARD = 100
PRICE_SPECIAL = 150
# No animal is flagged special yet -- the tier concept is structurally
# supported (see CollectibleTier/tier_for/price_for) so Melissa can promote
# an animal later with no schema/code change, just adding a slug here.
_SPECIAL_SLUGS: set[str] = set()

# ~3 curated placeholder photos per animal for now (Melissa's real curated
# collectible photos will drop in later as a content change, not a code
# change -- see animalContent.ts's imageCandidates(), which this reuses).
PHOTO_POOL_SIZE = 3


def tier_for(animal_slug: str) -> CollectibleTier:
    return CollectibleTier.SPECIAL if animal_slug in _SPECIAL_SLUGS else CollectibleTier.STANDARD


def price_for(animal_slug: str) -> int:
    return PRICE_SPECIAL if animal_slug in _SPECIAL_SLUGS else PRICE_STANDARD


def get_catalog() -> list[CollectibleCatalogEntry]:
    return [
        CollectibleCatalogEntry(animal_slug=slug, tier=tier_for(slug), price=price_for(slug)) for slug in ANIMAL_SLUGS
    ]


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _row_to_card(row: dict) -> CollectibleCard:
    return CollectibleCard(
        id=row["id"],
        animal_slug=row["animal_slug"],
        tier=row["tier"],
        photo_index=row["photo_index"],
        guest_name=row["guest_name"],
        coins_spent=row["coins_spent"],
        created_at=_parse_timestamptz(row["created_at"]),
    )


def list_cards(session_id: UUID) -> list[CollectibleCard]:
    client = get_supabase_client()
    rows = (
        client.table("collectible_redemptions")
        .select("*")
        .eq("session_id", str(session_id))
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return [_row_to_card(r) for r in rows]


def purchase(animal_slug: str, guest_name: str, session_id: UUID) -> CollectibleCard:
    if animal_slug not in ANIMAL_SLUGS:
        raise NotFoundError(f"Unknown animal '{animal_slug}'")

    price = price_for(animal_slug)
    if coins_service.get_total(session_id) < price:
        raise ConflictError(f"Not enough Cobb Coins -- this card costs {price}")

    client = get_supabase_client()
    row = (
        client.table("collectible_redemptions")
        .insert(
            {
                "animal_slug": animal_slug,
                "tier": tier_for(animal_slug).value,
                "photo_index": random.randint(1, PHOTO_POOL_SIZE),
                "guest_name": guest_name,
                "coins_spent": price,
                "session_id": str(session_id),
            }
        )
        .execute()
        .data[0]
    )
    return _row_to_card(row)
