"""Dev-only reset for the "Demo Family" bingo card + all map nodes.

Not an API endpoint on purpose — this is for repeatedly re-running through
the app during manual/QA testing, not something the app itself should ever
trigger. Run from anywhere with the backend venv active:

    python backend/scripts/reset_demo_data.py

Resets:
  - every bingo_tiles row on the "Demo Family" card: completed = false,
    completed_at = null
  - that card's milestone_lines/milestone_x/milestone_blackout back to none
  - every map_nodes row (all cards share the same map): state = 'not_visited'
  - every puzzle_attempts row deleted, so the Puzzle Timer specs start from
    a clean slate (no prior attempts) each run
  - Math Maze's "Standard" challenge pinned to staff_time_seconds = 2, so the
    e2e specs have a deterministic value to compare elapsed time against
    (real staff times otherwise get set directly in the DB by park staff --
    there's no in-app UI for it in this POC)
  - every hunt_progress row: challenges_completed = [], completed_at = null,
    so the Scavenger Hunt specs start with every character un-started
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.supabase_client import get_supabase_client  # noqa: E402

DEMO_CARD_OWNER_LABEL = "Demo Family"


def reset_demo_data() -> None:
    client = get_supabase_client()

    card_rows = client.table("bingo_cards").select("id").eq("owner_label", DEMO_CARD_OWNER_LABEL).execute().data
    if not card_rows:
        raise RuntimeError(f'No bingo card found with owner_label "{DEMO_CARD_OWNER_LABEL}"')
    card_id = card_rows[0]["id"]

    tile_rows = (
        client.table("bingo_tiles")
        .update({"completed": False, "completed_at": None})
        .eq("card_id", card_id)
        .execute()
        .data
    )
    print(f"Reset {len(tile_rows)} bingo tile(s) on the '{DEMO_CARD_OWNER_LABEL}' card.")

    client.table("bingo_cards").update(
        {"milestone_lines": [], "milestone_x": False, "milestone_blackout": False}
    ).eq("id", card_id).execute()
    print(f"Cleared milestone state on the '{DEMO_CARD_OWNER_LABEL}' card.")

    # PostgREST rejects an UPDATE with no WHERE clause at all; `id <> the nil
    # UUID` is a standard no-op filter that matches every real row.
    node_rows = (
        client.table("map_nodes")
        .update({"state": "not_visited"})
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Reset {len(node_rows)} map node(s) to not_visited.")

    # Same "no bare delete" PostgREST rule as the map_nodes update above.
    attempt_rows = (
        client.table("puzzle_attempts")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(attempt_rows)} puzzle attempt(s).")

    math_maze_rows = client.table("puzzles").select("id").eq("name", "Math Maze").execute().data
    if not math_maze_rows:
        raise RuntimeError('No puzzle found named "Math Maze"')
    client.table("puzzle_challenges").update({"staff_time_seconds": 2}).eq(
        "puzzle_id", math_maze_rows[0]["id"]
    ).eq("label", "Standard").execute()
    print('Pinned Math Maze "Standard" staff_time_seconds to 2.')

    # Same "no bare filterless update" PostgREST rule as map_nodes above.
    progress_rows = (
        client.table("hunt_progress")
        .update({"challenges_completed": [], "completed_at": None})
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Reset {len(progress_rows)} hunt progress row(s).")


if __name__ == "__main__":
    reset_demo_data()
