"""Orchestration for the Puzzle Solving Timer endpoints (Plan.md 2.3).

Timer start/stop and hint-tier progression are pure client-side UI state (the
challenge row already carries all 3 hint tiers, and there's no server-side
anti-cheat layer in this POC) -- the only thing that hits the database here
is fetching puzzles/challenges and recording attempts (elapsed time + hints
used). The result screen compares elapsed_seconds against the challenge's
staff_time_seconds client-side; there's no leaderboard/ranking anymore.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.errors import NotFoundError
from app.models import CoinSourceType, Puzzle, PuzzleAttempt, PuzzleChallenge
from app.services import coins as coins_service
from app.supabase_client import get_supabase_client


def _row_to_challenge(row: dict) -> PuzzleChallenge:
    return PuzzleChallenge(
        id=row["id"],
        puzzle_id=row["puzzle_id"],
        label=row["label"],
        description=row["description"],
        staff_time_seconds=row["staff_time_seconds"],
        solution_type=row["solution_type"],
        hint_tier_1=row["hint_tier_1"],
        hint_tier_2=row["hint_tier_2"],
        hint_tier_3=row["hint_tier_3"],
    )


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def list_puzzles() -> list[Puzzle]:
    client = get_supabase_client()
    puzzle_rows = client.table("puzzles").select("*").order("created_at").execute().data
    challenge_rows = client.table("puzzle_challenges").select("*").order("sort_order").execute().data

    challenges_by_puzzle: dict[str, list[PuzzleChallenge]] = {}
    for row in challenge_rows:
        challenges_by_puzzle.setdefault(row["puzzle_id"], []).append(_row_to_challenge(row))

    return [
        Puzzle(
            id=p["id"],
            name=p["name"],
            rules_text=p["rules_text"],
            challenges=challenges_by_puzzle.get(p["id"], []),
        )
        for p in puzzle_rows
    ]


def record_attempt(challenge_id: UUID, elapsed_seconds: int, hints_used: int) -> PuzzleAttempt:
    client = get_supabase_client()

    challenge_rows = client.table("puzzle_challenges").select("id").eq("id", str(challenge_id)).execute().data
    if not challenge_rows:
        raise NotFoundError(f"Puzzle challenge {challenge_id} not found")

    row = (
        client.table("puzzle_attempts")
        .insert({"challenge_id": str(challenge_id), "elapsed_seconds": elapsed_seconds, "hints_used": hints_used})
        .execute()
        .data[0]
    )
    coins_service.award_coins(
        CoinSourceType.PUZZLE_TIMER, UUID(row["id"]), coins_service.puzzle_timer_amount(hints_used)
    )
    return PuzzleAttempt(
        id=row["id"],
        challenge_id=row["challenge_id"],
        elapsed_seconds=row["elapsed_seconds"],
        hints_used=row["hints_used"],
        created_at=_parse_timestamptz(row["created_at"]),
    )
