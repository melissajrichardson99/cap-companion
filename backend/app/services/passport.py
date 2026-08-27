"""Orchestration for the Family Passport end-of-visit rollup (Plan.md 2.8).

Stats are computed once at generation time and frozen into the session row
as a JSON snapshot (not re-derived on read) -- see the schema comment on
passport_sessions for why. passport_sessions itself is scoped to the calling
device (Per-Device Sessions Phase 4, migration 027), attributing each
generated passport to the device that generated it.

Every stat in the snapshot is read scoped to device_session_id: Cobb Coins
(Phase 1), Scoring Sheet / Puzzle Timer (Phase 2), Bingo (Phase 6a, migration
029), and now Scavenger Hunt (Phase 6b, migration 030 -- the final phase of
the Per-Device Sessions migration) below. See _compute_stats.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from app.models import MilestonesAchieved, PassportSession, PassportStats
from app.services import coins as coins_service
from app.services import milestone as milestone_service
from app.supabase_client import get_supabase_client

BUCKET = "family-passport-photos"

# Reference maximums used to normalize wildly different category scales
# (5 hunt characters vs. 25 bingo tiles vs. open-ended win counts) onto a
# comparable 0-1 "strength" score for title selection. Scavenger Hunt and
# Bingo use their true seeded maximums (5 characters, a 25-tile card), so
# those two are genuine completion percentages. Puzzle Timer's true maximum
# is 9 challenges across all 6 puzzles (3+1+2+1+1+1, per migration 005).
# Scoring Sheet has no natural per-family ceiling -- a family can win the
# same game repeatedly or play just one of the 5 -- so 3 wins is a judgment
# call for "clearly good at this" rather than a hard total.
_HUNT_CHARACTERS_TOTAL = 5
_BINGO_TILES_TOTAL = 25
_PUZZLE_CHALLENGES_TOTAL = 9
_SCORING_WINS_REFERENCE = 3

# If a family is strong (>= 60%) across 3 or more of the 4 categories, a
# single-category title ("Maze Masters") undersells how well-rounded their
# visit was -- so an all-rounder title takes priority over the strongest
# single category in that case.
_ALL_ROUND_STRENGTH_THRESHOLD = 0.6
_ALL_ROUND_CATEGORY_COUNT = 3

_CATEGORY_TITLES = {
    "scavenger_hunt": "Wildlife Explorers",
    "bingo": "Bingo All-Stars",
    "puzzle": "Maze Masters",
    "scoring": "Sharpshooter Family",
}

# Tie-break order when two+ categories land on the exact same strength
# (most commonly 0-0-0-0 before the "all zero" fallback below applies, or a
# family that did literally nothing in two categories) -- arbitrary but
# deterministic, so identical stats always produce the same title.
_CATEGORY_PRIORITY = ["scavenger_hunt", "bingo", "puzzle", "scoring"]


def _category_strengths(hunt: int, bingo: int, puzzle: int, scoring: int) -> dict[str, float]:
    return {
        "scavenger_hunt": min(hunt / _HUNT_CHARACTERS_TOTAL, 1.0),
        "bingo": min(bingo / _BINGO_TILES_TOTAL, 1.0),
        "puzzle": min(puzzle / _PUZZLE_CHALLENGES_TOTAL, 1.0),
        "scoring": min(scoring / _SCORING_WINS_REFERENCE, 1.0),
    }


def _pick_title(hunt: int, bingo: int, puzzle: int, scoring: int) -> str:
    strengths = _category_strengths(hunt, bingo, puzzle, scoring)

    if all(v == 0 for v in strengths.values()):
        return "Cobb's Adventure Family"

    strong_categories = sum(1 for v in strengths.values() if v >= _ALL_ROUND_STRENGTH_THRESHOLD)
    if strong_categories >= _ALL_ROUND_CATEGORY_COUNT:
        return "Cobb's All-Star Family"

    best = max(_CATEGORY_PRIORITY, key=lambda c: strengths[c])
    return _CATEGORY_TITLES[best]


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _photo_url(storage_path: str | None) -> str | None:
    if storage_path is None:
        return None
    client = get_supabase_client()
    return client.storage.from_(BUCKET).get_public_url(storage_path)


def _row_to_session(row: dict) -> PassportSession:
    return PassportSession(
        id=row["id"],
        family_label=row["family_label"],
        photo_url=_photo_url(row["photo_storage_path"]),
        generated_at=_parse_timestamptz(row["generated_at"]),
        stats=PassportStats(**row["stats"]),
    )


def _compute_stats(client, device_session_id: UUID) -> PassportStats:
    """device_session_id scopes every data source to the calling device: Cobb
    Coins (Per-Device Sessions Phase 1), Scoring Sheet + Puzzle Timer (Phase
    2, migration 025), Bingo (Phase 6a, migration 029), and now Scavenger
    Hunt (Phase 6b, migration 030) below. Collectible Cards and Map node
    visited-status (Phases 1 and 3) are migrated too but were never part of
    this rollup's stats to begin with -- PassportStats has no field for
    either.

    hunt_progress rows are created lazily (one per session per character,
    only once that session unlocks/completes it -- migration 030), so a
    session that hasn't found every character simply has fewer rows here,
    not fewer completed_at values among a fixed set of 5; counting
    completed_at values directly (rather than checking "all of them", as
    hunt.py's all-characters-complete bonus guard has to) is correct either
    way."""
    hunt_progress_rows = (
        client.table("hunt_progress")
        .select("completed_at")
        .eq("session_id", str(device_session_id))
        .execute()
        .data
    )
    hunt_characters_total = len(client.table("hunt_characters").select("id").execute().data)
    hunt_completed = sum(1 for r in hunt_progress_rows if r["completed_at"] is not None)

    # Same "single active card" assumption App.tsx makes (it auto-selects
    # list_bingo_cards()[0]) -- there's no per-family card linking in this
    # POC to pick a different one from.
    card_rows = client.table("bingo_cards").select("id").order("created_at").limit(1).execute().data
    bingo_completed = 0
    bingo_tiles_total = _BINGO_TILES_TOTAL
    milestones = MilestonesAchieved()
    if card_rows:
        card = card_rows[0]
        tile_rows = (
            client.table("bingo_tiles").select("id,row_index,col_index").eq("card_id", card["id"]).execute().data
        )
        bingo_tiles_total = len(tile_rows) or _BINGO_TILES_TOTAL
        completion_rows = (
            client.table("session_tile_completions")
            .select("tile_id")
            .eq("session_id", str(device_session_id))
            .in_("tile_id", [t["id"] for t in tile_rows])
            .execute()
            .data
        )
        completed_tile_ids = {r["tile_id"] for r in completion_rows}
        bingo_completed = len(completed_tile_ids)
        completed_indices = {
            t["row_index"] * 5 + t["col_index"] for t in tile_rows if t["id"] in completed_tile_ids
        }
        lines, x, blackout = milestone_service.achieved_milestones(completed_indices)
        milestones = MilestonesAchieved(lines=sorted(lines), x=x, blackout=blackout)

    scoring_rows = (
        client.table("score_sheet_sessions")
        .select("completed_at")
        .eq("device_session_id", str(device_session_id))
        .execute()
        .data
    )
    scoring_won = sum(1 for r in scoring_rows if r["completed_at"] is not None)

    puzzle_attempt_rows = (
        client.table("puzzle_attempts")
        .select("challenge_id")
        .eq("session_id", str(device_session_id))
        .execute()
        .data
    )
    puzzle_completed = len({r["challenge_id"] for r in puzzle_attempt_rows})

    total_coins = coins_service.get_total(device_session_id)

    title = _pick_title(hunt_completed, bingo_completed, puzzle_completed, scoring_won)

    return PassportStats(
        scavenger_hunt_characters_completed=hunt_completed,
        scavenger_hunt_characters_total=hunt_characters_total,
        bingo_tiles_completed=bingo_completed,
        bingo_tiles_total=bingo_tiles_total,
        bingo_milestones=milestones,
        scoring_sheet_games_won=scoring_won,
        puzzle_challenges_completed=puzzle_completed,
        total_cobb_coins=total_coins,
        title=title,
    )


def generate_passport(
    family_label: str,
    filename: str | None,
    content_type: str | None,
    file_bytes: bytes | None,
    device_session_id: UUID,
) -> PassportSession:
    client = get_supabase_client()

    storage_path = None
    if file_bytes is not None:
        photo_id = uuid4()
        suffix = filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else "jpg"
        storage_path = f"{photo_id}.{suffix}"
        client.storage.from_(BUCKET).upload(
            storage_path, file_bytes, {"content-type": content_type or "application/octet-stream"}
        )

    stats = _compute_stats(client, device_session_id)

    row = (
        client.table("passport_sessions")
        .insert(
            {
                "session_id": str(device_session_id),
                "family_label": family_label,
                "photo_storage_path": storage_path,
                "stats": stats.model_dump(mode="json"),
            }
        )
        .execute()
        .data[0]
    )
    return _row_to_session(row)
