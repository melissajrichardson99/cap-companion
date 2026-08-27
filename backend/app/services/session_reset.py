"""Guest-facing "Reset Session" — narrower than the dev-only reset_demo_data.py script.

Per-Device Sessions Phase 6b (migration 030) was the final phase of the
Per-Device Sessions migration -- every originally-per-session feature is now
genuinely session-scoped here, table by table:

  - coin_awards, collectible_redemptions (Phase 1), puzzle_attempts, and
    score_sheet_sessions (Phase 2, migration 025) are scoped to the calling
    session: this call clears only *the caller's own* Cobb Coins ledger,
    purchased Collectible Cards, Puzzle Timer attempts, and Scoring Sheet
    sessions, leaving every other concurrent session's rows in those four
    tables completely untouched. score_entries has no row of this call's own
    to delete -- it cascades automatically off the score_sheet_sessions
    delete below (`on delete cascade`, migration 025).
  - node_visits (Phase 3, migration 026) is likewise scoped to the calling
    session: this call clears only *the caller's own* Map visited-status.
    map_nodes.state was dropped entirely in migration 026, so Map
    visited-status is fully, cleanly per-session. (map_nodes.is_open is
    untouched by Reset Session either way -- it's staff-managed operational
    status, not guest visit progress.)
  - photo_votes (Phase 5, migration 028) is likewise scoped to the calling
    session: this call clears only *the caller's own* Favorite Photo vote
    row(s), so the caller can vote again. This is a deliberate departure
    from Family Passport's exception just below -- unlike a passport, a
    vote was already meant to be revocable by the pre-existing (now retired)
    voterSession.ts mechanism, which minted a fresh token on Reset Session
    so the same guest could vote again. That mechanism never rotated
    device_sessions' own token (see migration 027's comment, confirmed
    still true), so preserving "vote again after Reset Session" here
    requires actually deleting the row rather than relying on a token swap
    that no longer happens. This also fixes a latent bug in the old
    mechanism: because the old token rotated but the prior vote row was
    never cleaned up, the same physical device's repeat vote (across
    resets) silently double-counted in the tally forever. Deleting the row
    here means a reset-then-revote nets back to one vote, not two.
    photo_submissions (the gallery photos themselves) and their aggregate
    vote tally are untouched for every *other* session -- only this
    session's own vote row(s) are removed.
  - session_tile_completions (Phase 6a, migration 029) is likewise scoped to
    the calling session: this call clears only *the caller's own* Bingo tile
    completions (and, since milestone status is now computed live off that
    same table -- see app/services/milestone.py's achieved_milestones -- its
    milestone progress along with it). bingo_cards/bingo_tiles (the shared
    layout) are untouched, same as map_nodes.is_open above.
  - hunt_progress (Phase 6b, migration 030 -- the last table migrated) is
    likewise scoped to the calling session: this call clears only *the
    caller's own* Scavenger Hunt found/unlocked and challenge-completion
    progress, so this guest's own 5 characters go back to fully anonymous
    and locked while leaving every other concurrent session's Hunt progress
    on the same shared hunt_characters/hunt_challenges content completely
    untouched. hunt_characters/hunt_challenges (the character definitions,
    theming, and challenge content) are untouched, same as bingo_cards/
    bingo_tiles and map_nodes above.

There is no remaining transitional/mixed-behavior table left in this
function -- every feature that was ever session-scoped by this migration
(Bingo, Hunt, Coins, Collectibles, Passport, Puzzle Timer, Scoring Sheet, map
node visited-status, Favorite Photo vote) is now genuinely per-session.
Nothing coin-, collectible-, puzzle-, scoring-, map-visit-, hunt-, or
vote-related is meant to outlive a visit (the guest's own downloaded/shared
card image or score sheet is the "real" persistence, per each feature's
design), and unlike reset_demo_data.py this still leaves staff requests,
photo submissions, and passports untouched -- those were never part of this
call's scope to begin with, not a leftover gap.

Family Passport (Phase 4, migration 027) was considered for the per-session
list above and deliberately left out even though passport_sessions is now
session-scoped: a passport is a one-time end-of-visit keepsake (see the
schema comment on passport_sessions.stats). Favorite Photo's *vote* is a
different case, not the same exception -- see photo_votes above.

Announcements and Attraction open/closed status (map_nodes.is_open) were
never part of Reset Session's scope at any point in this migration -- both
are genuinely global, staff-managed content with no per-guest progress
concept, not features this migration ever touched.
"""

from __future__ import annotations

from uuid import UUID

from app.models import ResetSessionResult
from app.supabase_client import get_supabase_client


def reset_session(session_id: UUID) -> ResetSessionResult:
    client = get_supabase_client()

    tile_rows = (
        client.table("session_tile_completions").delete().eq("session_id", str(session_id)).execute().data
    )

    node_visit_rows = client.table("node_visits").delete().eq("session_id", str(session_id)).execute().data

    progress_rows = (
        client.table("hunt_progress").delete().eq("session_id", str(session_id)).execute().data
    )

    coin_rows = client.table("coin_awards").delete().eq("session_id", str(session_id)).execute().data

    collectible_rows = (
        client.table("collectible_redemptions").delete().eq("session_id", str(session_id)).execute().data
    )

    puzzle_attempt_rows = client.table("puzzle_attempts").delete().eq("session_id", str(session_id)).execute().data

    # Cascades to score_entries (on delete cascade, migration 025) -- no
    # separate score_entries delete needed here.
    scoring_session_rows = (
        client.table("score_sheet_sessions").delete().eq("device_session_id", str(session_id)).execute().data
    )

    photo_vote_rows = client.table("photo_votes").delete().eq("session_id", str(session_id)).execute().data

    return ResetSessionResult(
        bingo_tiles_reset=len(tile_rows),
        map_nodes_reset=len(node_visit_rows),
        hunt_characters_reset=len(progress_rows),
        coins_reset=len(coin_rows),
        collectible_cards_reset=len(collectible_rows),
        puzzle_attempts_reset=len(puzzle_attempt_rows),
        scoring_sessions_reset=len(scoring_session_rows),
        photo_votes_reset=len(photo_vote_rows),
    )
