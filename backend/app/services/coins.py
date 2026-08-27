"""Orchestration for the Cobb Coins ledger (collectible/reward layer, POC scope).

coin_awards is an append-only ledger, not a mutable balance column -- the
running total is always derived by summing it, same "derive, don't
duplicate" discipline as MapNode.linked_bingo_tile_ids in models.py.
award_coins() is the only writer, called from the existing completion
trigger points in map_bingo.py (bingo_milestone, map_exploration), hunt.py
(scavenger_hunt, hunt_complete), puzzles.py (puzzle_timer), and
scoring_sheet.py (scoring_sheet_win) -- this module doesn't own any of those
triggers itself. hunt_complete and map_exploration are one-time-per-session
bonuses; their idempotency guard is simply checking whether a coin_awards row
of that source_type (and, per Per-Device Sessions Phase 1 below, session_id)
already exists.

Per-Device Sessions Phase 1 (migration 024) scopes this whole ledger to
device_sessions: every function here now takes a session_id and every
read/write is filtered/tagged by it, so each device's balance is fully
independent of every other device's. Reset Session (app/services/
session_reset.py) clears only the calling session's own rows, resetting
that session's idempotency guards for free -- no separate tracking flag
needed. This is the first ledger migrated under the per-device-sessions
project; Bingo/Hunt/Map/Passport's own state (as opposed to the coins they
award) is still global as of this phase -- Puzzle Timer and Scoring Sheet's
own state joined coins in being session-scoped as of Phase 2 (migration
025). See session_reset.py's docstring.

The spend side (Collectible Cards, app/services/collectibles.py) lives in
its own append-only ledger, collectible_redemptions, rather than negative
rows here -- this table's `amount > 0` CHECK stays earn-only. get_total()
below nets the two ledgers together, so it's still the one place "how many
coins does this session have right now" is computed.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.models import CoinAward, CoinsSummary, CoinSourceType
from app.supabase_client import get_supabase_client

SCAVENGER_HUNT_CHARACTER_AMOUNT = 15
SCAVENGER_HUNT_COMPLETE_BONUS = 25
SCORING_SHEET_WIN_AMOUNT = 10
MAP_EXPLORATION_AMOUNT = 50

BINGO_LINE_AMOUNT = 10
BINGO_X_DOUBLE_AMOUNT = 25
BINGO_BLACKOUT_AMOUNT = 50

# Fewer hints used -> more coins. Keyed by PuzzleAttempt.hints_used (0-3,
# see RecordAttemptRequest in models.py).
_PUZZLE_TIMER_AMOUNTS_BY_HINTS_USED = {0: 12, 1: 9, 2: 6, 3: 3}


def puzzle_timer_amount(hints_used: int) -> int:
    return _PUZZLE_TIMER_AMOUNTS_BY_HINTS_USED[hints_used]


# Keyed by milestone.MilestoneHit.type. "x" and "double_bingo" share a tier
# -- whichever single tier a tile completion's display_hit lands on (see
# milestone.select_display_milestone) is the only one that gets paid, so
# this map is what keeps the coin award and the displayed banner in
# agreement on simultaneous-tier completions.
_BINGO_MILESTONE_AMOUNTS = {
    "line": BINGO_LINE_AMOUNT,
    "double_bingo": BINGO_X_DOUBLE_AMOUNT,
    "x": BINGO_X_DOUBLE_AMOUNT,
    "blackout": BINGO_BLACKOUT_AMOUNT,
}


def bingo_milestone_amount(milestone_type: str) -> int:
    return _BINGO_MILESTONE_AMOUNTS[milestone_type]


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _row_to_award(row: dict) -> CoinAward:
    return CoinAward(
        id=row["id"],
        source_type=row["source_type"],
        source_id=row["source_id"],
        amount=row["amount"],
        created_at=_parse_timestamptz(row["created_at"]),
    )


def award_coins(source_type: CoinSourceType, source_id: UUID, amount: int, session_id: UUID) -> CoinAward:
    client = get_supabase_client()
    row = (
        client.table("coin_awards")
        .insert(
            {
                "source_type": source_type.value,
                "source_id": str(source_id),
                "amount": amount,
                "session_id": str(session_id),
            }
        )
        .execute()
        .data[0]
    )
    return _row_to_award(row)


def get_total(session_id: UUID) -> int:
    client = get_supabase_client()
    earned_rows = (
        client.table("coin_awards").select("amount").eq("session_id", str(session_id)).execute().data
    )
    spent_rows = (
        client.table("collectible_redemptions")
        .select("coins_spent")
        .eq("session_id", str(session_id))
        .execute()
        .data
    )
    earned = sum(r["amount"] for r in earned_rows)
    spent = sum(r["coins_spent"] for r in spent_rows)
    return earned - spent


def get_summary(session_id: UUID) -> CoinsSummary:
    return CoinsSummary(total=get_total(session_id))
