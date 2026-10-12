"""Resolves a scanned/manually-entered code to its Hunt character or
Encyclopedia entry -- app.services.scan_codes owns the code format itself.

This is Hunt's QR-scan/deep-link entry point: a guest's camera app opening a
printed sign's <frontend_base_url>/scan/:code URL hits GET /scan/{code}
directly, with no prior in-app navigation. The device session is still
established correctly on that path -- the frontend's request() helper
attaches the X-Device-Session header (minting a token into localStorage on
first use if none exists yet) on every API call unconditionally, including
this one, so a fresh device landing straight on a deep link gets a session
the same way normal in-app navigation does. This endpoint just needs to
actually thread that session_id through to hunt_service.get_character so the
resolved character reflects *this session's* found/unlocked status, same as
every other Hunt read since migration 030."""

from __future__ import annotations

from uuid import UUID

from app import reference_cache
from app.errors import ConflictError, NotFoundError
from app.models import EncyclopediaEntry, ManualEntryMatchType, ManualEntryResolution, ScanResult, ScanResultType
from app.services import hunt as hunt_service
from app.services.animals import ANIMAL_SLUGS
from app.services.scan_codes import normalize_code
from app.supabase_client import get_supabase_client


def _row_to_entry(row: dict) -> EncyclopediaEntry:
    return EncyclopediaEntry(id=row["id"], animal_name=row["animal_name"], status=row["status"])


def cached_scannable_code(code: str) -> dict | None:
    """The scannable_codes row for an already-normalized code, or None.

    The whole table (one row per printed sign) is shared reference data and
    is cached as one entry (app/reference_cache.py) rather than per code, so
    looking up made-up codes can't grow the cache. No API writes this table;
    signage codes are added by migration and show up within the default
    TTL."""
    client = get_supabase_client()
    rows = reference_cache.get(
        reference_cache.SCANNABLE_CODES, lambda: client.table("scannable_codes").select("*").execute().data
    )
    return next((r for r in rows if r["code"] == code), None)


def resolve_code(raw_code: str, session_id: UUID | None) -> ScanResult:
    client = get_supabase_client()
    code = normalize_code(raw_code)

    row = cached_scannable_code(code)
    if row is None:
        raise NotFoundError(f'No scannable code "{code}" found')

    if row["hunt_character_id"]:
        character = hunt_service.get_character(row["hunt_character_id"], session_id)
        return ScanResult(type=ScanResultType.HUNT_CHARACTER, target=character)

    entry_rows = reference_cache.get(
        reference_cache.ENCYCLOPEDIA_ENTRIES, lambda: client.table("encyclopedia_entries").select("*").execute().data
    )
    entry_row = next((r for r in entry_rows if r["id"] == row["encyclopedia_entry_id"]), None)
    if entry_row is None:
        raise NotFoundError(f'Encyclopedia entry for code "{code}" not found')
    return ScanResult(type=ScanResultType.ENCYCLOPEDIA_ENTRY, target=_row_to_entry(entry_row))


def resolve_manual_entry(raw_text: str) -> ManualEntryResolution:
    """Resolves free-typed sign text against every QR-routable destination --
    Hunt/Encyclopedia codes (scannable_codes), Scoring game slugs, Puzzle
    challenge slugs, and Our Animals slugs -- since ScanEntryModal's manual
    entry field is one shared input, not a per-destination-type one. Camera
    decodes never need this: the QR itself encodes a full URL whose path
    prefix says the type outright (see ScanEntryModal.tsx). This is only for
    a guest typing what's printed on the sign, which carries no such prefix.

    Animal slugs have no table of their own (Our Animals is static frontend
    content, not DB-backed) -- ANIMAL_SLUGS (app/services/animals.py), the
    canonical backend-side mirror of that roster, stands in for a real query
    there.

    Deliberately not served from the reference cache: it's never on a page
    load (only when a guest types a sign code), and it's the check that
    catches a new cross-table slug collision, so it should see the database
    as it is right now.
    """
    client = get_supabase_client()
    text = normalize_code(raw_text)

    matches: list[ManualEntryResolution] = []

    if client.table("scannable_codes").select("code").eq("code", text).execute().data:
        matches.append(ManualEntryResolution(type=ManualEntryMatchType.SCAN, slug=text))
    if text in ANIMAL_SLUGS:
        matches.append(ManualEntryResolution(type=ManualEntryMatchType.ANIMAL, slug=text))
    if client.table("scoring_games").select("slug").eq("slug", text).execute().data:
        matches.append(ManualEntryResolution(type=ManualEntryMatchType.SCORING_GAME, slug=text))
    if client.table("puzzle_challenges").select("slug").eq("slug", text).execute().data:
        matches.append(ManualEntryResolution(type=ManualEntryMatchType.PUZZLE_CHALLENGE, slug=text))

    if len(matches) > 1:
        matched_types = ", ".join(m.type.value for m in matches)
        raise ConflictError(
            f'"{text}" matches more than one QR destination ({matched_types}) -- '
            "this is a content-authoring collision, not a guest error; a staff "
            "member needs to rename one of them (see check_slug_collisions.py)"
        )
    if not matches:
        raise NotFoundError(f'No code, game, puzzle, or animal matching "{text}" found')
    return matches[0]


def _collisions_among(sources: dict[ManualEntryMatchType, list[str]]) -> dict[str, list[ManualEntryMatchType]]:
    """Pure grouping logic behind find_cross_type_collisions -- split out so
    it's unit-testable without a live DB, same "pure logic vs. DB-backed"
    split as collectibles.py/test_collectibles.py."""
    seen: dict[str, list[ManualEntryMatchType]] = {}
    for kind, texts in sources.items():
        for text in texts:
            seen.setdefault(text, []).append(kind)
    return {text: kinds for text, kinds in seen.items() if len(kinds) > 1}


def find_cross_type_collisions() -> dict[str, list[ManualEntryMatchType]]:
    """Every text value that appears under more than one QR-routable
    namespace. scannable_codes, scoring_games.slug, and puzzle_challenges.slug
    each already enforce their own uniqueness at the DB level, but nothing
    enforces uniqueness *across* those tables, and Animal slugs (ANIMAL_SLUGS)
    aren't DB-backed at all -- so no single DB constraint can cover all four
    sources. Run this manually (see scripts/check_slug_collisions.py)
    whenever a new scannable code, scoring game, or puzzle challenge is added
    via migration, since there's no staff-facing creation UI for any of them
    yet that could otherwise check this automatically.
    """
    client = get_supabase_client()
    sources = {
        ManualEntryMatchType.SCAN: [
            row["code"] for row in client.table("scannable_codes").select("code").execute().data
        ],
        ManualEntryMatchType.ANIMAL: list(ANIMAL_SLUGS),
        ManualEntryMatchType.SCORING_GAME: [
            row["slug"] for row in client.table("scoring_games").select("slug").execute().data
        ],
        ManualEntryMatchType.PUZZLE_CHALLENGE: [
            row["slug"] for row in client.table("puzzle_challenges").select("slug").execute().data
        ],
    }
    return _collisions_among(sources)
