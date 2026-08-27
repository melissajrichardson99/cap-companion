"""Orchestration for the Scavenger Hunt endpoints.

Answer validation for mc/matching/true_false_set/image_mc challenges is
client-side only, against the correct-answer fields already embedded in each
challenge's content -- same "no server-side anti-cheat" scope as the Puzzle
Timer (app/services/puzzles.py). All the backend does is record that a
challenge was completed and roll that up into the character's progress.

Per-Device Sessions Phase 6b (migration 030, final phase): hunt_progress is
now one row per (session, character) pair, not one row per character
globally -- each family's own found/unfound and challenge-completion status
on the shared hunt_characters/hunt_challenges content. hunt_characters/
hunt_challenges themselves are NOT migrated -- they stay global reference
content, same as Bingo's tile layout and the map node catalog.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app.errors import NotFoundError
from app.models import CoinSourceType, HuntCharacter, HuntChallenge
from app.services import coins as coins_service
from app.supabase_client import get_supabase_client


def _row_to_challenge(row: dict) -> HuntChallenge:
    return HuntChallenge(
        id=row["id"],
        character_id=row["character_id"],
        order_index=row["order_index"],
        type=row["type"],
        content=row["content"] or {},
        metadata=row["metadata"] or {},
    )


def _character_from_rows(char_row: dict, challenge_rows: list[dict], progress_row: dict | None) -> HuntCharacter:
    return HuntCharacter(
        id=char_row["id"],
        name=char_row["name"],
        species_category=char_row["species_category"],
        minigame_slug=char_row["minigame_slug"],
        challenges=[_row_to_challenge(r) for r in sorted(challenge_rows, key=lambda r: r["order_index"])],
        challenges_completed=sorted(progress_row["challenges_completed"]) if progress_row else [],
        completed_at=progress_row["completed_at"] if progress_row else None,
        unlocked=bool(progress_row and progress_row["unlocked_at"] is not None),
    )


def _get_or_create_progress(client, session_id: UUID, character_id: str) -> dict:
    """The calling session's hunt_progress row for one character, creating it
    (with default/locked values) on first touch -- rows are no longer
    pre-seeded (migration 030), so this is the single place that "found this
    character for the first time" gets represented as a real row, same
    "insert on first touch" shape as session_tile_completions."""
    rows = (
        client.table("hunt_progress")
        .select("*")
        .eq("session_id", str(session_id))
        .eq("character_id", character_id)
        .execute()
        .data
    )
    if rows:
        return rows[0]
    return (
        client.table("hunt_progress")
        .insert({"session_id": str(session_id), "character_id": character_id})
        .execute()
        .data[0]
    )


def list_characters(session_id: UUID) -> list[HuntCharacter]:
    client = get_supabase_client()
    char_rows = client.table("hunt_characters").select("*").order("sort_order").execute().data
    challenge_rows = client.table("hunt_challenges").select("*").execute().data
    progress_rows = client.table("hunt_progress").select("*").eq("session_id", str(session_id)).execute().data

    challenges_by_character: dict[str, list[dict]] = {}
    for row in challenge_rows:
        challenges_by_character.setdefault(row["character_id"], []).append(row)

    progress_by_character: dict[str, dict] = {row["character_id"]: row for row in progress_rows}

    return [
        _character_from_rows(
            c,
            challenges_by_character.get(c["id"], []),
            progress_by_character.get(c["id"]),
        )
        for c in char_rows
    ]


def get_character(character_id: UUID | str, session_id: UUID | None = None) -> HuntCharacter:
    """session_id is optional: None returns the character with no progress
    resolved (always locked, no challenges completed) -- used only by the QR
    code image endpoint (GET /scan/{code}/qr.png), which just validates a
    code exists and carries no device session of its own. Every guest-facing
    caller passes a real session_id."""
    client = get_supabase_client()

    char_rows = client.table("hunt_characters").select("*").eq("id", str(character_id)).execute().data
    if not char_rows:
        raise NotFoundError(f"Hunt character {character_id} not found")

    challenge_rows = client.table("hunt_challenges").select("*").eq("character_id", str(character_id)).execute().data

    progress_row = None
    if session_id is not None:
        progress_rows = (
            client.table("hunt_progress")
            .select("*")
            .eq("character_id", str(character_id))
            .eq("session_id", str(session_id))
            .execute()
            .data
        )
        progress_row = progress_rows[0] if progress_rows else None

    return _character_from_rows(char_rows[0], challenge_rows, progress_row)


def unlock_character(character_id: UUID | str, session_id: UUID) -> HuntCharacter:
    """Marks a character unlocked *for this session* (first scan/manual-code
    entry of its QR code). Idempotent -- set once, monotonically, like
    completed_at above -- so re-scanning an already-unlocked character is a
    silent no-op rather than an error or a re-triggered unlock. Two sessions
    scanning the same physical sign each get their own independent unlock."""
    client = get_supabase_client()

    char_rows = client.table("hunt_characters").select("id").eq("id", str(character_id)).execute().data
    if not char_rows:
        raise NotFoundError(f"Hunt character {character_id} not found")

    progress_row = _get_or_create_progress(client, session_id, str(character_id))
    if progress_row["unlocked_at"] is None:
        client.table("hunt_progress").update({"unlocked_at": datetime.now(timezone.utc).isoformat()}).eq(
            "id", progress_row["id"]
        ).execute()

    return get_character(character_id, session_id)


def complete_challenge(challenge_id: UUID, session_id: UUID) -> HuntCharacter:
    client = get_supabase_client()

    challenge_rows = client.table("hunt_challenges").select("*").eq("id", str(challenge_id)).execute().data
    if not challenge_rows:
        raise NotFoundError(f"Hunt challenge {challenge_id} not found")
    challenge_row = challenge_rows[0]
    character_id = challenge_row["character_id"]

    progress_row = _get_or_create_progress(client, session_id, character_id)

    completed = set(progress_row["challenges_completed"]) | {challenge_row["order_index"]}
    update = {"challenges_completed": sorted(completed)}
    just_completed_character = {1, 2, 3}.issubset(completed) and progress_row["completed_at"] is None
    if just_completed_character:
        update["completed_at"] = datetime.now(timezone.utc).isoformat()

    client.table("hunt_progress").update(update).eq("id", progress_row["id"]).execute()

    coins_awarded = 0
    if just_completed_character:
        coins_service.award_coins(
            CoinSourceType.SCAVENGER_HUNT,
            UUID(character_id),
            coins_service.SCAVENGER_HUNT_CHARACTER_AMOUNT,
            session_id,
        )
        coins_awarded += coins_service.SCAVENGER_HUNT_CHARACTER_AMOUNT

        # Check whether this session has now completed all 5 characters, i.e.
        # the whole hunt is done *for this family*. hunt_progress is per-
        # session now (migration 030) and rows are created lazily on first
        # touch (_get_or_create_progress), not pre-seeded -- so a session
        # that has only unlocked/completed some characters may have fewer
        # than hunt_characters_total rows at all. The old global version of
        # this check (`all(r["completed_at"] is not None for r in
        # all_progress)`) relied on there always being exactly 5 rows
        # (pre-seeded once, globally); over a per-session row set that
        # invariant no longer holds, so the row *count* must be checked
        # too -- otherwise a session with e.g. 1 completed character and 0
        # other rows would vacuously pass `all(...)` over that single-row
        # list and fire the bonus after only 1 of 5 characters.
        all_progress = (
            client.table("hunt_progress").select("completed_at").eq("session_id", str(session_id)).execute().data
        )
        characters_total = len(client.table("hunt_characters").select("id").execute().data)
        all_characters_complete = len(all_progress) == characters_total and all(
            r["completed_at"] is not None for r in all_progress
        )
        if all_characters_complete:
            # The +25 bonus guard itself was already session-scoped (Per-
            # Device Sessions Phase 1, "harmless, for consistency" at the
            # time, since the underlying completed_at transition was still
            # global then). That guard's behavior is unchanged and still
            # correct now that the underlying progress data is genuinely
            # per-session too: only one request, from whichever session
            # actually completes its own 5th character, can ever reach this
            # branch for that session, and the existing_bonus check below
            # keeps it a one-time-per-session award.
            existing_bonus = (
                client.table("coin_awards")
                .select("id")
                .eq("source_type", CoinSourceType.HUNT_COMPLETE.value)
                .eq("session_id", str(session_id))
                .execute()
                .data
            )
            if not existing_bonus:
                coins_service.award_coins(
                    CoinSourceType.HUNT_COMPLETE,
                    UUID(character_id),
                    coins_service.SCAVENGER_HUNT_COMPLETE_BONUS,
                    session_id,
                )
                coins_awarded += coins_service.SCAVENGER_HUNT_COMPLETE_BONUS

    character = get_character(character_id, session_id)
    character.coins_awarded = coins_awarded
    return character
