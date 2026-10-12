"""Dev-only reset for the "Demo Family" bingo card + all map nodes.

Not an API endpoint on purpose — this is for repeatedly re-running through
the app during manual/QA testing, not something the app itself should ever
trigger. Run from anywhere with the backend venv active:

    python backend/scripts/reset_demo_data.py

Resets:
  - every session_tile_completions row deleted (Per-Device Sessions Phase
    6a, migration 029) -- completed/completed_at and the milestone_lines/
    milestone_x/milestone_blackout columns no longer exist on bingo_tiles/
    bingo_cards; completion + milestone status is now computed live per
    device session from session_tile_completions, so a blanket delete resets
    every session's Bingo progress at once, same "dev-only, no per-session
    scoping" reasoning as the rest of this script
  - every node_visits row deleted, so every device session's Map visited
    status starts fresh (Per-Device Sessions Phase 3 -- map_nodes no longer
    has a `state` column to reset in place)
  - every puzzle_attempts row deleted, so the Puzzle Timer specs start from
    a clean slate (no prior attempts) each run
  - Math Maze's "Standard" challenge pinned to staff_time_seconds = 2, so the
    e2e specs have a deterministic value to compare elapsed time against
    (real staff times otherwise get set directly in the DB by park staff --
    there's no in-app UI for it in this POC)
  - every hunt_progress row deleted across every device session (Per-Device
    Sessions Phase 6b, migration 030) -- rows are no longer pre-seeded one
    per character; each is created lazily the first time a session unlocks
    or completes a challenge for a character, so a blanket delete is the
    equivalent reset (every session's Hunt progress goes back to no rows at
    all, i.e. every character un-started and locked), same "dev-only, no
    per-session scoping" reasoning as session_tile_completions above
  - every staff_requests row deleted, so the Contact Staff specs start with
    an empty staff view each run
  - every announcements row deleted -- a leftover undismissed announcement
    from a prior run blocks every guest-facing spec's page.goto('/') behind
    the popup's full-screen backdrop (see announcements.spec.ts), so this is
    a safety net even when that file's own afterEach cleanup does its job
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

import dev_test_data  # noqa: E402

DEMO_CARD_OWNER_LABEL = "Demo Family"


def reset_demo_data() -> None:
    client = get_supabase_client()

    card_rows = client.table("bingo_cards").select("id").eq("owner_label", DEMO_CARD_OWNER_LABEL).execute().data
    if not card_rows:
        raise RuntimeError(f'No bingo card found with owner_label "{DEMO_CARD_OWNER_LABEL}"')

    # Blanket delete across every device session, not scoped to this card's
    # tiles -- session_tile_completions holds every session's Bingo
    # completion/milestone progress (Per-Device Sessions Phase 6a, migration
    # 029), and this dev-only script has no single "current session" to
    # scope to. Same "no bare filterless delete" PostgREST rule as the other
    # blanket wipes below.
    completion_rows = (
        client.table("session_tile_completions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(completion_rows)} bingo tile completion(s) across all device sessions.")

    # Same "no bare filterless delete" PostgREST rule as the other blanket
    # wipes in this script.
    node_visit_rows = (
        client.table("node_visits")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(node_visit_rows)} map node visit(s).")

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

    # Blanket delete across every device session, not scoped to any one
    # session -- same reasoning as session_tile_completions above. Rows are
    # no longer pre-seeded (migration 030), so deleting them all is the
    # equivalent of resetting every session's Hunt progress to fully
    # un-started and locked.
    progress_rows = (
        client.table("hunt_progress")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(progress_rows)} hunt progress row(s) across all device sessions.")

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

    # Same "no bare filterless delete" PostgREST rule as staff_requests above.
    announcement_rows = (
        client.table("announcements")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Deleted {len(announcement_rows)} announcement(s).")

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


# Production guard (dev_test_data.run_dev_only): refuses -- before any
# database call -- unless SUPABASE_URL's project ref is in
# DEV_SUPABASE_PROJECT_REFS (backend/.env, dev machines only).
if __name__ == "__main__":
    dev_test_data.run_dev_only(reset_demo_data)
