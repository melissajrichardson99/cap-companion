"""Guest-facing "Reset Session" — narrower than the dev-only reset_demo_data.py script.

Clears: Bingo tile completion + milestone state, Map node visited state,
Scavenger Hunt challenge/unlock progress (so the next group must re-scan
each character's QR code, same as a fresh visit), and the entire Cobb Coins
ledger (coin_awards) -- coins are tied to this session, not persistent
identity, so nothing coin-related should survive a reset. Note this clears
*all* coin_awards rows regardless of source_type, including puzzle_timer and
scoring_sheet_win awards -- those features' own completion state (puzzle
attempts, scoring sheet sessions) is untouched by Reset Session, only the
coins earned from them. Unlike reset_demo_data.py, this still leaves staff
requests, photos, and passports untouched.
"""

from __future__ import annotations

from app.models import ResetSessionResult
from app.supabase_client import get_supabase_client

# PostgREST rejects an UPDATE with no WHERE clause at all; `id <> the nil
# UUID` is a standard no-op filter that matches every real row (same
# reasoning as reset_demo_data.py's bare updates).
_MATCH_ALL_ID = "00000000-0000-0000-0000-000000000000"


def reset_session() -> ResetSessionResult:
    client = get_supabase_client()

    tile_rows = (
        client.table("bingo_tiles")
        .update({"completed": False, "completed_at": None})
        .neq("id", _MATCH_ALL_ID)
        .execute()
        .data
    )

    client.table("bingo_cards").update(
        {"milestone_lines": [], "milestone_x": False, "milestone_blackout": False}
    ).neq("id", _MATCH_ALL_ID).execute()

    node_rows = (
        client.table("map_nodes")
        .update({"state": "not_visited"})
        .neq("id", _MATCH_ALL_ID)
        .execute()
        .data
    )

    progress_rows = (
        client.table("hunt_progress")
        .update({"challenges_completed": [], "completed_at": None, "unlocked_at": None})
        .neq("id", _MATCH_ALL_ID)
        .execute()
        .data
    )

    coin_rows = client.table("coin_awards").delete().neq("id", _MATCH_ALL_ID).execute().data

    return ResetSessionResult(
        bingo_tiles_reset=len(tile_rows),
        map_nodes_reset=len(node_rows),
        hunt_characters_reset=len(progress_rows),
        coins_reset=len(coin_rows),
    )
