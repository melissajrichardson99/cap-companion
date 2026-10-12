"""Manual verification for the session cleanup housekeeping job
(app/services/session_cleanup.py) -- run against the real dev Supabase
project, same as reset_demo_data.py / e2e_collision_fixture.py in this
directory.

Not part of the pytest suite (backend/tests/, pure-logic-only -- see
test_guest_auth.py's docstring: DB round trips are "verified live/e2e" in
this codebase) or the Playwright e2e suite (this needs to seed
device_sessions rows with fabricated old last_active_at timestamps and a
guest-linked session, which no existing API endpoint supports --
get_or_create_session always sets last_active_at to "now" -- so it reaches
the DB directly with the service-role client, same reasoning as
e2e_collision_fixture.py's docstring).

    python backend/scripts/verify_session_cleanup.py

Each scenario seeds its own fixture rows, asserts the expected outcome, and
cleans up after itself (via try/finally) regardless of pass/fail, so repeated
runs never accumulate leftover fixture data. The "full cleanup" and
"batching" scenarios deliberately drive real calls into
cleanup_abandoned_sessions(), which also sweeps up whatever real accumulated
stale anonymous sessions already exist in this database -- that IS the
behavior being verified, not test pollution.
"""

from __future__ import annotations

import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import session_cleanup  # noqa: E402
from app.services.passport import BUCKET as PASSPORT_BUCKET  # noqa: E402
from app.supabase_client import get_supabase_client  # noqa: E402

import dev_test_data  # noqa: E402

FAR_PAST_DAYS = 40  # comfortably past session_cleanup.INACTIVITY_THRESHOLD (14 days)
RECENT_DAYS = 1


def _iso(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def _fetch_fk_targets(client) -> dict:
    """One real, already-seeded row id from each table a full session's
    child rows need to point at -- these are permanent content (seed.sql),
    never touched by cleanup itself."""
    puzzle_challenge = client.table("puzzle_challenges").select("id").limit(1).execute().data
    scoring_game = client.table("scoring_games").select("id").limit(1).execute().data
    map_node = client.table("map_nodes").select("id").limit(1).execute().data
    bingo_tile = client.table("bingo_tiles").select("id").limit(1).execute().data
    hunt_character = client.table("hunt_characters").select("id").limit(1).execute().data
    if not all([puzzle_challenge, scoring_game, map_node, bingo_tile, hunt_character]):
        raise RuntimeError("Dev DB is missing seeded content needed to build test fixtures -- run seed.sql first.")
    return {
        "puzzle_challenge_id": puzzle_challenge[0]["id"],
        "scoring_game_id": scoring_game[0]["id"],
        "map_node_id": map_node[0]["id"],
        "bingo_tile_id": bingo_tile[0]["id"],
        "hunt_character_id": hunt_character[0]["id"],
    }


def _insert_full_session(client, fk: dict, *, guest_id: str | None, last_active_at: str) -> dict:
    """Seeds one device_sessions row plus one row in every table
    session_cleanup.py touches, so a single fixture exercises the entire
    per-table policy at once. Returns every id needed to assert on
    afterward."""
    session_id = str(uuid4())
    client.table("device_sessions").insert(
        {
            "id": session_id,
            "device_token": f"cleanup-verify-{uuid4()}",
            "created_at": last_active_at,
            "last_active_at": last_active_at,
            "guest_id": guest_id,
        }
    ).execute()

    staff_request_id = (
        client.table("staff_requests")
        .insert({"type": "question", "session_id": session_id})
        .execute()
        .data[0]["id"]
    )

    photo_submission_id = (
        client.table("photo_submissions")
        .insert({"storage_path": f"cleanup-verify-{uuid4()}.txt", "status": "pending_review"})
        .execute()
        .data[0]["id"]
    )

    passport_photo_path = f"cleanup-verify-{uuid4()}.txt"
    client.storage.from_(PASSPORT_BUCKET).upload(
        passport_photo_path, b"verification fixture", {"content-type": "text/plain"}
    )
    passport_id = (
        client.table("passport_sessions")
        .insert(
            {
                "session_id": session_id,
                "family_label": "Cleanup Verify Family",
                "photo_storage_path": passport_photo_path,
                "stats": {},
                "guest_id": guest_id,
            }
        )
        .execute()
        .data[0]["id"]
    )

    coin_award_id = (
        client.table("coin_awards")
        .insert({"session_id": session_id, "source_type": "map_exploration", "source_id": str(uuid4()), "amount": 5})
        .execute()
        .data[0]["id"]
    )

    collectible_id = (
        client.table("collectible_redemptions")
        .insert(
            {
                "session_id": session_id,
                "animal_slug": "cleanup-verify-animal",
                "tier": "standard",
                "photo_index": 1,
                "guest_name": "Cleanup Verify",
                "coins_spent": 5,
            }
        )
        .execute()
        .data[0]["id"]
    )

    puzzle_attempt_id = (
        client.table("puzzle_attempts")
        .insert({"challenge_id": fk["puzzle_challenge_id"], "session_id": session_id, "elapsed_seconds": 30})
        .execute()
        .data[0]["id"]
    )

    score_sheet_id = (
        client.table("score_sheet_sessions")
        .insert({"game_id": fk["scoring_game_id"], "device_session_id": session_id, "players": ["Verify Player"]})
        .execute()
        .data[0]["id"]
    )

    node_visit_id = (
        client.table("node_visits")
        .insert({"session_id": session_id, "node_id": fk["map_node_id"]})
        .execute()
        .data[0]["id"]
    )

    tile_completion_id = (
        client.table("session_tile_completions")
        .insert({"session_id": session_id, "tile_id": fk["bingo_tile_id"]})
        .execute()
        .data[0]["id"]
    )

    photo_vote_id = (
        client.table("photo_votes")
        .insert({"submission_id": photo_submission_id, "session_id": session_id})
        .execute()
        .data[0]["id"]
    )

    hunt_progress_id = (
        client.table("hunt_progress")
        .insert({"session_id": session_id, "character_id": fk["hunt_character_id"]})
        .execute()
        .data[0]["id"]
    )

    return {
        "session_id": session_id,
        "staff_request_id": staff_request_id,
        "photo_submission_id": photo_submission_id,
        "passport_id": passport_id,
        "passport_photo_path": passport_photo_path,
        "coin_award_id": coin_award_id,
        "collectible_id": collectible_id,
        "puzzle_attempt_id": puzzle_attempt_id,
        "score_sheet_id": score_sheet_id,
        "node_visit_id": node_visit_id,
        "tile_completion_id": tile_completion_id,
        "photo_vote_id": photo_vote_id,
        "hunt_progress_id": hunt_progress_id,
    }


def _row_exists(client, table: str, row_id: str) -> bool:
    return bool(client.table(table).select("id").eq("id", row_id).execute().data)


def _teardown_full_session(client, ids: dict) -> None:
    """Best-effort cleanup of every row/object _insert_full_session may have
    created, regardless of whether cleanup_abandoned_sessions() already
    removed some of them -- every call here is a no-op if its target is
    already gone."""
    # Children before the device_sessions parent -- same NO ACTION FK
    # ordering constraint session_cleanup.py itself has to respect (see its
    # docstring); staff_requests is nulled instead of deleted, same as the
    # real cleanup job, so it never blocks the device_sessions delete either
    # way.
    client.table("staff_requests").delete().eq("id", ids["staff_request_id"]).execute()
    client.table("passport_sessions").delete().eq("id", ids["passport_id"]).execute()
    client.storage.from_(PASSPORT_BUCKET).remove([ids["passport_photo_path"]])
    client.table("photo_votes").delete().eq("id", ids["photo_vote_id"]).execute()
    client.table("photo_submissions").delete().eq("id", ids["photo_submission_id"]).execute()
    client.table("coin_awards").delete().eq("id", ids["coin_award_id"]).execute()
    client.table("collectible_redemptions").delete().eq("id", ids["collectible_id"]).execute()
    client.table("puzzle_attempts").delete().eq("id", ids["puzzle_attempt_id"]).execute()
    client.table("score_sheet_sessions").delete().eq("id", ids["score_sheet_id"]).execute()
    client.table("node_visits").delete().eq("id", ids["node_visit_id"]).execute()
    client.table("session_tile_completions").delete().eq("id", ids["tile_completion_id"]).execute()
    client.table("hunt_progress").delete().eq("id", ids["hunt_progress_id"]).execute()
    client.table("device_sessions").delete().eq("id", ids["session_id"]).execute()


def verify_guest_linked_session_is_never_touched(client, fk: dict) -> None:
    """THE hard rule: a guest-linked session, however stale, must be
    completely untouched by cleanup -- checked across every child table, not
    just device_sessions itself."""
    guest_id = (
        client.table("guests")
        .insert({"email": f"cleanup-verify-{uuid4()}@example.com", "password_hash": "not-a-real-hash"})
        .execute()
        .data[0]["id"]
    )
    ids = _insert_full_session(client, fk, guest_id=guest_id, last_active_at=_iso(FAR_PAST_DAYS))
    try:
        session_cleanup.cleanup_abandoned_sessions()

        assert _row_exists(client, "device_sessions", ids["session_id"]), "guest-linked device_sessions row was deleted!"
        for table, row_id in [
            ("staff_requests", ids["staff_request_id"]),
            ("passport_sessions", ids["passport_id"]),
            ("coin_awards", ids["coin_award_id"]),
            ("collectible_redemptions", ids["collectible_id"]),
            ("puzzle_attempts", ids["puzzle_attempt_id"]),
            ("score_sheet_sessions", ids["score_sheet_id"]),
            ("node_visits", ids["node_visit_id"]),
            ("session_tile_completions", ids["tile_completion_id"]),
            ("photo_votes", ids["photo_vote_id"]),
            ("hunt_progress", ids["hunt_progress_id"]),
        ]:
            assert _row_exists(client, table, row_id), f"guest-linked session's {table} row was deleted!"

        staff_request = (
            client.table("staff_requests").select("session_id").eq("id", ids["staff_request_id"]).execute().data[0]
        )
        assert staff_request["session_id"] == ids["session_id"], "guest-linked session's staff_requests row was detached!"

        # options={"search": ...} filters server-side by name -- a plain
        # .list() only returns the bucket's default first page, which could
        # silently miss this object in a bucket with many existing files.
        storage_matches = client.storage.from_(PASSPORT_BUCKET).list(options={"search": ids["passport_photo_path"]})
        assert storage_matches, "guest-linked session's passport photo was removed from Storage!"
    finally:
        _teardown_full_session(client, ids)
        client.table("guests").delete().eq("id", guest_id).execute()


def verify_full_cleanup_of_old_anonymous_session(client, fk: dict) -> None:
    ids = _insert_full_session(client, fk, guest_id=None, last_active_at=_iso(FAR_PAST_DAYS))
    try:
        session_cleanup.cleanup_abandoned_sessions()

        assert not _row_exists(client, "device_sessions", ids["session_id"]), "old anonymous device_sessions row survived"
        for table, row_id in [
            ("passport_sessions", ids["passport_id"]),
            ("coin_awards", ids["coin_award_id"]),
            ("collectible_redemptions", ids["collectible_id"]),
            ("puzzle_attempts", ids["puzzle_attempt_id"]),
            ("score_sheet_sessions", ids["score_sheet_id"]),
            ("node_visits", ids["node_visit_id"]),
            ("session_tile_completions", ids["tile_completion_id"]),
            ("photo_votes", ids["photo_vote_id"]),
            ("hunt_progress", ids["hunt_progress_id"]),
        ]:
            assert not _row_exists(client, table, row_id), f"old anonymous session's {table} row survived cleanup"

        # staff_requests: detached, never deleted.
        staff_request_rows = (
            client.table("staff_requests").select("id,session_id").eq("id", ids["staff_request_id"]).execute().data
        )
        assert staff_request_rows, "staff_requests row was deleted -- it must only be detached"
        assert staff_request_rows[0]["session_id"] is None, "staff_requests row was not detached (session_id still set)"

        storage_matches = client.storage.from_(PASSPORT_BUCKET).list(options={"search": ids["passport_photo_path"]})
        assert not storage_matches, "passport photo was left behind in Storage"
    finally:
        # passport_sessions/device_sessions/etc. should already be gone; this
        # is just a safety net for a failed assertion mid-run. staff_requests
        # needs an explicit delete since cleanup only detaches it.
        _teardown_full_session(client, ids)


def verify_recent_anonymous_session_is_left_alone(client, fk: dict) -> None:
    ids = _insert_full_session(client, fk, guest_id=None, last_active_at=_iso(RECENT_DAYS))
    try:
        session_cleanup.cleanup_abandoned_sessions()
        assert _row_exists(client, "device_sessions", ids["session_id"]), "recently-active anonymous session was deleted!"
        assert _row_exists(client, "coin_awards", ids["coin_award_id"]), "recently-active session's coin_awards row was deleted!"
    finally:
        _teardown_full_session(client, ids)


def verify_batching_across_a_realistic_volume(client) -> None:
    """session_cleanup.BATCH_SIZE is 200 -- seed comfortably past that so a
    single cleanup_abandoned_sessions() call must loop through multiple
    batches to fully clear them, independent of whatever else the dev DB
    already has accumulated."""
    seed_count = session_cleanup.BATCH_SIZE + 50
    session_ids = [str(uuid4()) for _ in range(seed_count)]
    rows = [
        {
            "id": sid,
            "device_token": f"cleanup-verify-batch-{sid}",
            "created_at": _iso(FAR_PAST_DAYS),
            "last_active_at": _iso(FAR_PAST_DAYS),
            "guest_id": None,
        }
        for sid in session_ids
    ]
    # Supabase/PostgREST caps request body size -- insert in chunks.
    for i in range(0, len(rows), 200):
        client.table("device_sessions").insert(rows[i : i + 200]).execute()

    try:
        result = session_cleanup.cleanup_abandoned_sessions()
        assert result.sessions_cleaned >= seed_count, (
            f"expected at least {seed_count} sessions cleaned in one call, got {result.sessions_cleaned}"
        )
        remaining = (
            client.table("device_sessions").select("id").in_("id", session_ids).limit(1).execute().data
        )
        assert not remaining, "some seeded sessions survived a single cleanup_abandoned_sessions() call"
    finally:
        for i in range(0, len(session_ids), 200):
            client.table("device_sessions").delete().in_("id", session_ids[i : i + 200]).execute()


SCENARIOS = [
    verify_guest_linked_session_is_never_touched,
    verify_full_cleanup_of_old_anonymous_session,
    verify_recent_anonymous_session_is_left_alone,
    verify_batching_across_a_realistic_volume,
]


def main() -> None:
    client = get_supabase_client()
    fk = _fetch_fk_targets(client)

    failures = []
    for scenario in SCENARIOS:
        name = scenario.__name__
        try:
            if scenario is verify_batching_across_a_realistic_volume:
                scenario(client)
            else:
                scenario(client, fk)
        except AssertionError as exc:
            failures.append(name)
            print(f"FAIL: {name} -- {exc}")
        except Exception:
            failures.append(name)
            print(f"ERROR: {name}")
            traceback.print_exc()
        else:
            print(f"PASS: {name}")

    if failures:
        print(f"\n{len(failures)} scenario(s) failed: {', '.join(failures)}")
        raise SystemExit(1)
    print(f"\nAll {len(SCENARIOS)} scenario(s) passed.")


# Production guard (dev_test_data.run_dev_only): refuses -- before any
# database call -- unless SUPABASE_URL's project ref is in
# DEV_SUPABASE_PROJECT_REFS (backend/.env, dev machines only).
if __name__ == "__main__":
    dev_test_data.run_dev_only(main)
