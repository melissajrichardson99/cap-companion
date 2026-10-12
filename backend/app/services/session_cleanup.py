"""Scheduled housekeeping: purge genuinely abandoned anonymous device
sessions and everything tied to them. Invoked via POST /internal/session-
cleanup (app/routers/internal.py), which a scheduled GitHub Actions workflow
hits on a cron -- see .github/workflows/session-cleanup.yml and
DEPLOYMENT.md for why GitHub Actions rather than Render's own Cron Job
(a separate billed service type, unlike the free web-service plan this
backend runs on).

THE hard rule, above everything else in this module: a session linked to a
guest account (device_sessions.guest_id is not null) must NEVER be touched,
no matter how long ago it was last active -- it's that guest's permanent
history, reachable forever through Coins/Collectibles/Bingo/Map's lifetime
join (see migration 036's header) and Family Passport's direct guest_id tag
(migration 038). This is enforced by filtering on `guest_id is null` twice,
not once: _select_batch's initial candidate query, and _reconfirm_unlinked's
re-check of that exact batch immediately before any destructive write (see
its docstring for why this closes the race window without needing a DB
transaction, which this codebase has no precedent for -- no stored
procedures/RPCs exist anywhere in backend/supabase/).

Per-table cleanup policy for each targeted session (guest_id IS NULL,
last_active_at more than INACTIVITY_THRESHOLD in the past):
  - staff_requests: content is preserved indefinitely for staff reference --
    session_id is nulled (detached), the row is never deleted (migration 039
    made this column nullable specifically for this).
  - passport_sessions: the Storage-backed group photo (if any) is removed
    from the 'family-passport-photos' bucket before the row itself, so
    cleanup never leaves an orphaned Storage object behind -- same "photo
    rows first, then Storage objects, then the rows themselves" ordering as
    backend/scripts/reset_demo_data.py.
  - Every other session-scoped table (coin_awards, collectible_redemptions,
    puzzle_attempts, score_sheet_sessions, node_visits,
    session_tile_completions, photo_votes, hunt_progress) is fully deleted.
    score_entries needs no separate handling -- it cascades automatically off
    score_sheet_sessions (`on delete cascade`, migration 025), same as
    session_reset.py relies on.
  - Finally, the device_sessions row itself is deleted.

Processed in batches (BATCH_SIZE), not one unbounded query -- the dev
database alone already has 3,600+ accumulated rows, and production will only
grow. Idempotent and concurrency-safe by construction: every delete/update
here is filtered by an explicit id list (and, for device_sessions, guest_id
IS NULL too), so re-running this job -- or two overlapping runs racing each
other -- just re-selects whatever candidates are still actually eligible;
acting on a row that's already gone (deleted by the other run) or already
null (staff_requests.session_id) is a no-op, never an error.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app import reference_cache
from app.models import SessionCleanupResult
from app.services.passport import BUCKET as PASSPORT_BUCKET
from app.supabase_client import get_supabase_client

logger = logging.getLogger("app")

INACTIVITY_THRESHOLD = timedelta(days=14)
BATCH_SIZE = 200

# (table, session-id column) pairs that get a full row delete, scoped to the
# batch's session ids -- every session-scoped table except staff_requests
# (detached, not deleted) and passport_sessions (needs its Storage object
# removed first, handled separately in _clean_batch).
_FULL_DELETE_TABLES: tuple[tuple[str, str], ...] = (
    ("coin_awards", "session_id"),
    ("collectible_redemptions", "session_id"),
    ("puzzle_attempts", "session_id"),
    ("score_sheet_sessions", "device_session_id"),
    ("node_visits", "session_id"),
    ("session_tile_completions", "session_id"),
    ("photo_votes", "session_id"),
    ("hunt_progress", "session_id"),
)


def _select_batch(client, cutoff_iso: str) -> list[str]:
    rows = (
        client.table("device_sessions")
        .select("id")
        .is_("guest_id", "null")
        .lt("last_active_at", cutoff_iso)
        .order("last_active_at")
        .limit(BATCH_SIZE)
        .execute()
        .data
    )
    return [row["id"] for row in rows]


def _reconfirm_unlinked(client, session_ids: list[str], cutoff_iso: str) -> list[str]:
    """Re-runs _select_batch's exact filter (guest_id is null AND
    last_active_at < cutoff) against just this batch's ids, immediately
    before any destructive write -- closes the race window between selecting
    a batch and acting on it (e.g. a guest logging in on one of these devices
    in between). Both POST /account/login and /account/signup resolve
    get_or_create_session -- which unconditionally bumps last_active_at to
    now -- before guest_accounts._link_device_session ever sets guest_id
    (see app/routers/account.py), so last_active_at alone already flips the
    instant any request touches a stale session, well before guest_id could
    ever be set. Any id that no longer qualifies is dropped here rather than
    acted on."""
    if not session_ids:
        return []
    rows = (
        client.table("device_sessions")
        .select("id")
        .in_("id", session_ids)
        .is_("guest_id", "null")
        .lt("last_active_at", cutoff_iso)
        .execute()
        .data
    )
    return [row["id"] for row in rows]


def _clean_batch(client, session_ids: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}

    detached = (
        client.table("staff_requests").update({"session_id": None}).in_("session_id", session_ids).execute().data
    )
    counts["staff_requests_detached"] = len(detached)

    passport_rows = (
        client.table("passport_sessions")
        .select("id,photo_storage_path")
        .in_("session_id", session_ids)
        .execute()
        .data
    )
    photo_paths = [row["photo_storage_path"] for row in passport_rows if row["photo_storage_path"]]
    if photo_paths:
        client.storage.from_(PASSPORT_BUCKET).remove(photo_paths)
    deleted_passports = client.table("passport_sessions").delete().in_("session_id", session_ids).execute().data
    counts["passport_sessions_deleted"] = len(deleted_passports)

    for table, column in _FULL_DELETE_TABLES:
        rows = client.table(table).delete().in_(column, session_ids).execute().data
        counts[f"{table}_deleted"] = len(rows)
    if counts.get("photo_votes_deleted"):
        # Vote counts are part of the cached guest gallery.
        reference_cache.invalidate(reference_cache.PHOTO_GALLERY)

    # guest_id IS NULL re-asserted here too -- belt-and-suspenders on top of
    # _reconfirm_unlinked's check moments ago, so this delete can never
    # remove a session that became guest-linked in the tiny remaining window
    # between that check and this call.
    deleted_sessions = (
        client.table("device_sessions").delete().in_("id", session_ids).is_("guest_id", "null").execute().data
    )
    counts["sessions_cleaned"] = len(deleted_sessions)
    return counts


def cleanup_abandoned_sessions() -> SessionCleanupResult:
    client = get_supabase_client()
    cutoff_iso = (datetime.now(timezone.utc) - INACTIVITY_THRESHOLD).isoformat()

    totals: dict[str, int] = {
        "sessions_cleaned": 0,
        "staff_requests_detached": 0,
        "passport_sessions_deleted": 0,
        "coin_awards_deleted": 0,
        "collectible_redemptions_deleted": 0,
        "puzzle_attempts_deleted": 0,
        "score_sheet_sessions_deleted": 0,
        "node_visits_deleted": 0,
        "session_tile_completions_deleted": 0,
        "photo_votes_deleted": 0,
        "hunt_progress_deleted": 0,
    }

    while True:
        batch_ids = _select_batch(client, cutoff_iso)
        if not batch_ids:
            break

        confirmed_ids = _reconfirm_unlinked(client, batch_ids, cutoff_iso)
        if not confirmed_ids:
            # Every candidate in this batch stopped qualifying between the
            # two checks (e.g. just got guest-linked) -- nothing safe to act
            # on right now. Stop this run rather than looping on the same
            # now-ineligible ids; the next scheduled run will simply not
            # re-select them (they no longer match guest_id is null and/or
            # last_active_at < cutoff).
            logger.warning("session_cleanup: batch of %d candidate(s) had none left eligible after re-check", len(batch_ids))
            break

        batch_counts = _clean_batch(client, confirmed_ids)
        for key, value in batch_counts.items():
            totals[key] += value

    logger.info(
        "session_cleanup: cleaned %d abandoned session(s) -- %s",
        totals["sessions_cleaned"],
        totals,
    )
    return SessionCleanupResult(**totals)
