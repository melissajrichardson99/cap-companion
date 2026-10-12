"""Map locations for QR destinations (Staff Visit Heatmap Phase 2, migration
042), and resolving a guest's scan to the map node it should count against.

Where each destination type's location lives:

- Hunt characters: hunt_characters.map_node_id (scanned by scannable_codes.code)
- Scoring games: scoring_games.map_node_id (scanned by slug)
- Puzzle challenges: the challenge's puzzle's puzzles.map_node_id (scanned by
  challenge slug) -- set per puzzle, not per challenge
- Our Animals: animal_map_locations, keyed by slug, since animals are static
  frontend content with no table of their own (ANIMAL_SLUGS mirrors them)

All of these are nullable: an unmapped destination still resolves, with
map_node_id None, so its scans are recorded as unmapped rather than lost.
"""

from __future__ import annotations

from uuid import UUID

from app import reference_cache
from app.errors import NotFoundError
from app.models import ManualEntryMatchType, QrDestinationType, QrLocation
from app.services import hunt as hunt_service
from app.services import puzzles as puzzles_service
from app.services import scan as scan_service
from app.services import scoring_sheet as scoring_sheet_service
from app.services.animals import ANIMAL_SLUGS
from app.services.scan_codes import normalize_code
from app.supabase_client import get_supabase_client

# Destination types that hold their location directly in a table column.
_LOCATION_TABLES = {
    QrDestinationType.HUNT_CHARACTER: "hunt_characters",
    QrDestinationType.SCORING_GAME: "scoring_games",
    QrDestinationType.PUZZLE: "puzzles",
}

# The reference-cache entry holding each destination type's location, which
# set_location clears in the same request (see app/reference_cache.py).
_CACHE_KEYS = {
    QrDestinationType.HUNT_CHARACTER: reference_cache.HUNT_CHARACTERS,
    QrDestinationType.SCORING_GAME: reference_cache.SCORING_GAMES,
    QrDestinationType.PUZZLE: reference_cache.PUZZLES,
    QrDestinationType.ANIMAL: reference_cache.ANIMAL_MAP_LOCATIONS,
}


class InvalidDestinationTypeError(ValueError):
    pass


def resolve_scan(scan_type: ManualEntryMatchType, raw_id: str) -> tuple[QrDestinationType, str, str | None] | None:
    """(destination_type, destination_id, map_node_id) for a scanned/typed
    destination, or None for a scan that isn't counted on the heatmap
    (Encyclopedia codes -- unprinted placeholders, not in the QR Code
    Directory). Raises NotFoundError for an unknown destination.
    destination_id is the scanned code/slug itself, so an unmapped scan is
    readable to staff without another lookup.

    Every lookup here reads the shared reference cache (the same cached
    tables the guest pages use), so logging a scan usually costs no read at
    all; set_location below keeps the locations current."""
    client = get_supabase_client()
    key = normalize_code(raw_id)

    if scan_type == ManualEntryMatchType.SCAN:
        code_row = scan_service.cached_scannable_code(key)
        if code_row is None:
            raise NotFoundError(f'No scannable code "{key}" found')
        if not code_row["hunt_character_id"]:
            return None
        character = next(c for c in hunt_service.cached_character_rows() if c["id"] == code_row["hunt_character_id"])
        return QrDestinationType.HUNT_CHARACTER, key, character["map_node_id"]

    if scan_type == ManualEntryMatchType.ANIMAL:
        if key not in ANIMAL_SLUGS:
            raise NotFoundError(f'No animal "{key}" found')
        rows = _cached_animal_locations(client)
        row = next((r for r in rows if r["animal_slug"] == key), None)
        return QrDestinationType.ANIMAL, key, row["map_node_id"] if row else None

    if scan_type == ManualEntryMatchType.SCORING_GAME:
        game = next((g for g in scoring_sheet_service.cached_game_rows() if g["slug"] == key), None)
        if game is None:
            raise NotFoundError(f'No scoring game "{key}" found')
        return QrDestinationType.SCORING_GAME, key, game["map_node_id"]

    challenge = next((c for c in puzzles_service.cached_challenge_rows() if c["slug"] == key), None)
    if challenge is None:
        raise NotFoundError(f'No puzzle challenge "{key}" found')
    puzzle = next(p for p in puzzles_service.cached_puzzle_rows() if p["id"] == challenge["puzzle_id"])
    return QrDestinationType.PUZZLE_CHALLENGE, key, puzzle["map_node_id"]


def _cached_animal_locations(client) -> list[dict]:
    return reference_cache.get(
        reference_cache.ANIMAL_MAP_LOCATIONS,
        lambda: client.table("animal_map_locations").select("animal_slug,map_node_id").execute().data,
    )


def list_locations() -> list[QrLocation]:
    """Every location-bearing QR destination with its current map node (or
    None), for the Staff QR Code Directory."""
    client = get_supabase_client()
    locations: list[QrLocation] = []
    for dtype, table in _LOCATION_TABLES.items():
        for row in client.table(table).select("id,map_node_id").execute().data:
            locations.append(QrLocation(destination_type=dtype, destination_id=row["id"], map_node_id=row["map_node_id"]))

    animal_rows = client.table("animal_map_locations").select("animal_slug,map_node_id").execute().data
    by_slug = {r["animal_slug"]: r["map_node_id"] for r in animal_rows}
    locations += [
        QrLocation(destination_type=QrDestinationType.ANIMAL, destination_id=slug, map_node_id=by_slug.get(slug))
        for slug in sorted(ANIMAL_SLUGS)
    ]
    return locations


def set_location(destination_type: QrDestinationType, destination_id: str, map_node_id: UUID | None) -> QrLocation:
    client = get_supabase_client()
    node_value = str(map_node_id) if map_node_id else None
    if node_value and not client.table("map_nodes").select("id").eq("id", node_value).execute().data:
        raise NotFoundError(f"Map node {map_node_id} not found")

    if destination_type == QrDestinationType.ANIMAL:
        if destination_id not in ANIMAL_SLUGS:
            raise NotFoundError(f'No animal "{destination_id}" found')
        try:
            client.table("animal_map_locations").upsert(
                {"animal_slug": destination_id, "map_node_id": node_value}, on_conflict="animal_slug"
            ).execute()
        finally:
            reference_cache.invalidate(_CACHE_KEYS[destination_type])
    elif destination_type in _LOCATION_TABLES:
        try:
            UUID(destination_id)
        except ValueError as exc:
            raise NotFoundError(f"No {destination_type.value} {destination_id} found") from exc
        try:
            updated = (
                client.table(_LOCATION_TABLES[destination_type])
                .update({"map_node_id": node_value})
                .eq("id", destination_id)
                .execute()
                .data
            )
        finally:
            reference_cache.invalidate(_CACHE_KEYS[destination_type])
        if not updated:
            raise NotFoundError(f"No {destination_type.value} {destination_id} found")
    else:
        # puzzle_challenge: a challenge's location is its puzzle's.
        raise InvalidDestinationTypeError(f"Locations can't be set per {destination_type.value}; set the puzzle's")

    return QrLocation(destination_type=destination_type, destination_id=destination_id, map_node_id=map_node_id)
