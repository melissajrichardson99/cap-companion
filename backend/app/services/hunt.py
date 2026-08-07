"""Orchestration for the Scavenger Hunt endpoints.

Answer validation for mc/matching/true_false_set/image_mc challenges is
client-side only, against the correct-answer fields already embedded in each
challenge's content -- same "no server-side anti-cheat" scope as the Puzzle
Timer (app/services/puzzles.py). All the backend does is record that a
challenge was completed and roll that up into the character's progress.
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
    )


def list_characters() -> list[HuntCharacter]:
    client = get_supabase_client()
    char_rows = client.table("hunt_characters").select("*").order("sort_order").execute().data
    challenge_rows = client.table("hunt_challenges").select("*").execute().data
    progress_rows = client.table("hunt_progress").select("*").execute().data

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


def get_character(character_id: UUID | str) -> HuntCharacter:
    client = get_supabase_client()

    char_rows = client.table("hunt_characters").select("*").eq("id", str(character_id)).execute().data
    if not char_rows:
        raise NotFoundError(f"Hunt character {character_id} not found")

    challenge_rows = client.table("hunt_challenges").select("*").eq("character_id", str(character_id)).execute().data
    progress_rows = client.table("hunt_progress").select("*").eq("character_id", str(character_id)).execute().data

    return _character_from_rows(char_rows[0], challenge_rows, progress_rows[0] if progress_rows else None)


def complete_challenge(challenge_id: UUID) -> HuntCharacter:
    client = get_supabase_client()

    challenge_rows = client.table("hunt_challenges").select("*").eq("id", str(challenge_id)).execute().data
    if not challenge_rows:
        raise NotFoundError(f"Hunt challenge {challenge_id} not found")
    challenge_row = challenge_rows[0]
    character_id = challenge_row["character_id"]

    progress_rows = client.table("hunt_progress").select("*").eq("character_id", character_id).execute().data
    if not progress_rows:
        raise NotFoundError(f"Hunt progress row for character {character_id} not found")
    progress_row = progress_rows[0]

    completed = set(progress_row["challenges_completed"]) | {challenge_row["order_index"]}
    update = {"challenges_completed": sorted(completed)}
    if {1, 2, 3}.issubset(completed) and progress_row["completed_at"] is None:
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
        coins_service.award_coins(
            CoinSourceType.SCAVENGER_HUNT, UUID(character_id), coins_service.SCAVENGER_HUNT_CHARACTER_AMOUNT
        )

    client.table("hunt_progress").update(update).eq("character_id", character_id).execute()

    char_rows = client.table("hunt_characters").select("*").eq("id", character_id).execute().data
    challenge_rows_for_character = (
        client.table("hunt_challenges").select("*").eq("character_id", character_id).execute().data
    )
    progress_row = client.table("hunt_progress").select("*").eq("character_id", character_id).execute().data[0]

    return _character_from_rows(char_rows[0], challenge_rows_for_character, progress_row)
