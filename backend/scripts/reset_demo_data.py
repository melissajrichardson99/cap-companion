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
  - every staff_requests row deleted, so the Contact Staff specs start with
    an empty staff view each run
  - every coin_awards row deleted, so the Cobb Coins specs start from a
    running total of 0 each run
  - every photo_submissions row (and its photo_votes, via cascade) deleted,
    plus the matching objects removed from Storage -- so the Favorite Photo
    specs start with an empty queue/gallery and the bucket doesn't
    accumulate test uploads across runs
  - every passport_sessions row deleted, plus any matching group-photo
    objects removed from Storage -- same reasoning as photo_submissions
    above, applied to the Family Passport bucket
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.passport import BUCKET as PASSPORT_BUCKET  # noqa: E402
from app.services.photos import BUCKET  # noqa: E402
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

    # Same "no bare filterless delete" PostgREST rule as puzzle_attempts above.
    staff_request_rows = (
        client.table("staff_requests")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(staff_request_rows)} staff request(s).")

    # Same "no bare filterless delete" PostgREST rule as staff_requests above.
    coin_award_rows = (
        client.table("coin_awards")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(coin_award_rows)} coin award(s).")

    # Photo rows first (need their storage_path values before they're gone),
    # then the Storage objects, then the rows themselves -- photo_votes cascades
    # with its parent photo_submissions row, same as bingo_tiles/card above.
    photo_rows = client.table("photo_submissions").select("id,storage_path").execute().data
    if photo_rows:
        client.storage.from_(BUCKET).remove([r["storage_path"] for r in photo_rows])
    deleted_photo_rows = (
        client.table("photo_submissions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(deleted_photo_rows)} photo submission(s) and their storage object(s).")

    # Same "photo rows first, then Storage objects, then the rows themselves"
    # ordering as photo_submissions above.
    passport_rows = client.table("passport_sessions").select("id,photo_storage_path").execute().data
    passport_photo_paths = [r["photo_storage_path"] for r in passport_rows if r["photo_storage_path"]]
    if passport_photo_paths:
        client.storage.from_(PASSPORT_BUCKET).remove(passport_photo_paths)
    deleted_passport_rows = (
        client.table("passport_sessions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(deleted_passport_rows)} passport session(s) and their storage object(s).")


if __name__ == "__main__":
    reset_demo_data()
