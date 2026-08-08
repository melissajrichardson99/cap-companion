"""Guest-facing "Reset Session" — narrower than the dev-only reset_demo_data.py script.

Clears only: Bingo tile completion + milestone state, Map node visited state,
and Scavenger Hunt challenge progress. Unlike reset_demo_data.py, this
deliberately leaves Cobb Coins, puzzle attempts, staff requests, photos, and
passports untouched -- a guest handing the phone to the next group shouldn't
lose coins/photos already earned, just the "what have we already done"
progress on the three exploration features.
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
        .update({"challenges_completed": [], "completed_at": None})
        .neq("id", _MATCH_ALL_ID)
        .execute()
        .data
    )

    return ResetSessionResult(
        bingo_tiles_reset=len(tile_rows),
        map_nodes_reset=len(node_rows),
        hunt_characters_reset=len(progress_rows),
    )
