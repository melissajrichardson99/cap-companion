"""Orchestration for the Cobb Coins ledger (collectible/reward layer, POC scope).

coin_awards is an append-only ledger, not a mutable balance column -- the
running total is always derived by summing it, same "derive, don't
duplicate" discipline as MapNode.linked_bingo_tile_ids in models.py. There's
no spend/redemption in this POC: award_coins() is the only writer, called
from the existing completion trigger points in map_bingo.py, hunt.py,
puzzles.py, and scoring_sheet.py -- this module doesn't own any of those
triggers itself.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.models import CoinAward, Collectible, CoinsSummary, CoinSourceType
from app.supabase_client import get_supabase_client

BINGO_TILE_AMOUNT = 2
SCAVENGER_HUNT_CHARACTER_AMOUNT = 15
SCORING_SHEET_WIN_AMOUNT = 10

# Fewer hints used -> more coins. Keyed by PuzzleAttempt.hints_used (0-3,
# see RecordAttemptRequest in models.py).
_PUZZLE_TIMER_AMOUNTS_BY_HINTS_USED = {0: 12, 1: 9, 2: 6, 3: 3}


def puzzle_timer_amount(hints_used: int) -> int:
    return _PUZZLE_TIMER_AMOUNTS_BY_HINTS_USED[hints_used]


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


def award_coins(source_type: CoinSourceType, source_id: UUID, amount: int) -> CoinAward:
    client = get_supabase_client()
    row = (
        client.table("coin_awards")
        .insert({"source_type": source_type.value, "source_id": str(source_id), "amount": amount})
        .execute()
        .data[0]
    )
    return _row_to_award(row)


def get_total() -> int:
    client = get_supabase_client()
    rows = client.table("coin_awards").select("amount").execute().data
    return sum(r["amount"] for r in rows)


def get_summary() -> CoinsSummary:
    total = get_total()
    client = get_supabase_client()
    collectible_rows = client.table("collectibles").select("*").order("unlock_threshold").execute().data
    collectibles = [
        Collectible(
            id=r["id"],
            name=r["name"],
            icon=r["icon"],
            unlock_threshold=r["unlock_threshold"],
            unlocked=total >= r["unlock_threshold"],
        )
        for r in collectible_rows
    ]
    return CoinsSummary(total=total, collectibles=collectibles)
