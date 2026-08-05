"""Pure leaderboard ranking/filtering logic for puzzle attempts.

No I/O and no framework dependency, kept pure on purpose so the daily-scope
date filtering and ranking is trivially unit-testable without a database in
the loop -- the same split as milestone.py and minigame_draw.py.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class AttemptRecord:
    id: str
    elapsed_seconds: int
    created_at: datetime


def rank_attempts(
    attempts: list[AttemptRecord],
    *,
    scope: str,  # "daily" | "all_time"
    now: datetime,
    limit: int = 10,
) -> list[AttemptRecord]:
    """Return the fastest `limit` attempts for the given scope, fastest first.

    "daily" keeps only attempts made on the same calendar date as `now`.
    Callers are responsible for passing `now` and `created_at` in the same
    timezone (both UTC in this app) so the date comparison lines up.
    """
    pool = attempts
    if scope == "daily":
        pool = [a for a in attempts if a.created_at.date() == now.date()]
    return sorted(pool, key=lambda a: a.elapsed_seconds)[:limit]
