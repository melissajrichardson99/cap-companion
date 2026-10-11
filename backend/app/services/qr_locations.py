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

from app.errors import NotFoundError
from app.models import ManualEntryMatchType, QrDestinationType, QrLocation
from app.services.animals import ANIMAL_SLUGS
from app.services.scan_codes import normalize_code
from app.supabase_client import get_supabase_client

# Destination types that hold their location directly in a table column.
_LOCATION_TABLES = {
    QrDestinationType.HUNT_CHARACTER: "hunt_characters",
    QrDestinationType.SCORING_GAME: "scoring_games",
    QrDestinationType.PUZZLE: "puzzles",
}


class InvalidDestinationTypeError(ValueError):
    pass


def resolve_scan(scan_type: ManualEntryMatchType, raw_id: str) -> tuple[QrDestinationType, str, str | None] | None:
    """(destination_type, destination_id, map_node_id) for a scanned/typed
    destination, or None for a scan that isn't counted on the heatmap
    (Encyclopedia codes -- unprinted placeholders, not in the QR Code
    Directory). Raises NotFoundError for an unknown destination.
    destination_id is the scanned code/slug itself, so an unmapped scan is
    readable to staff without another lookup."""
    client = get_supabase_client()
    key = normalize_code(raw_id)

    if scan_type == ManualEntryMatchType.SCAN:
        rows = (
            client.table("scannable_codes")
            .select("hunt_character_id,hunt_characters(map_node_id)")
            .eq("code", key)
            .execute()
            .data
        )
        if not rows:
            raise NotFoundError(f'No scannable code "{key}" found')
        if not rows[0]["hunt_character_id"]:
            return None
        return QrDestinationType.HUNT_CHARACTER, key, rows[0]["hunt_characters"]["map_node_id"]

    if scan_type == ManualEntryMatchType.ANIMAL:
        if key not in ANIMAL_SLUGS:
            raise NotFoundError(f'No animal "{key}" found')
        rows = client.table("animal_map_locations").select("map_node_id").eq("animal_slug", key).execute().data
        return QrDestinationType.ANIMAL, key, rows[0]["map_node_id"] if rows else None

    if scan_type == ManualEntryMatchType.SCORING_GAME:
        rows = client.table("scoring_games").select("map_node_id").eq("slug", key).execute().data
        if not rows:
            raise NotFoundError(f'No scoring game "{key}" found')
        return QrDestinationType.SCORING_GAME, key, rows[0]["map_node_id"]

    rows = client.table("puzzle_challenges").select("puzzles(map_node_id)").eq("slug", key).execute().data
    if not rows:
        raise NotFoundError(f'No puzzle challenge "{key}" found')
    return QrDestinationType.PUZZLE_CHALLENGE, key, rows[0]["puzzles"]["map_node_id"]


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
        client.table("animal_map_locations").upsert(
            {"animal_slug": destination_id, "map_node_id": node_value}, on_conflict="animal_slug"
        ).execute()
    elif destination_type in _LOCATION_TABLES:
        try:
            UUID(destination_id)
        except ValueError as exc:
            raise NotFoundError(f"No {destination_type.value} {destination_id} found") from exc
        updated = (
            client.table(_LOCATION_TABLES[destination_type])
            .update({"map_node_id": node_value})
            .eq("id", destination_id)
            .execute()
            .data
        )
        if not updated:
            raise NotFoundError(f"No {destination_type.value} {destination_id} found")
    else:
        # puzzle_challenge: a challenge's location is its puzzle's.
        raise InvalidDestinationTypeError(f"Locations can't be set per {destination_type.value}; set the puzzle's")

    return QrLocation(destination_type=destination_type, destination_id=destination_id, map_node_id=map_node_id)
