"""Pure stroke-play math for the mini golf Scoring Sheets (migration 043).

Second scoring mode alongside the turn-based one in app.services.scoring,
deliberately kept separate rather than bent to fit it: stroke play has a
fixed number of holes, 1-999 strokes per hole, no par, and the lowest total
wins once every player has finished every hole. No I/O, same discipline as
scoring.py / milestone.py, so totals, ties and validation are tested
directly (tests/test_stroke_play.py).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

STROKES_MIN = 1
STROKES_MAX = 999

STATUS_IN_PROGRESS = "in_progress"
STATUS_WON = "won"


@dataclass(frozen=True)
class HoleScoreLike:
    player_name: str
    hole_number: int
    strokes: int


@dataclass(frozen=True)
class StrokePlayResult:
    status: str  # STATUS_* above
    totals: dict[str, int]
    # Lowest total over the holes every player has finished -- the "current
    # leader" during play, the winner(s) once complete. Several on a tie.
    leaders: tuple[str, ...] = ()
    # Next empty cell in the guided order (hole by hole, players in order).
    # Both None once every cell is filled.
    current_hole: int | None = None
    current_player: str | None = None


def validate_strokes(value: object) -> int:
    """An integer 1-999. Rejects bools (an int subclass in Python), floats,
    and strings -- including leading-zero strings like "04": the keypad
    never sends one, so anything that isn't already a plain int is a client
    bug, not something to coerce."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("Strokes must be a whole number.")
    if not STROKES_MIN <= value <= STROKES_MAX:
        raise ValueError(f"Strokes must be between {STROKES_MIN} and {STROKES_MAX}.")
    return value


def validate_hole(hole_number: object, hole_count: int) -> int:
    if isinstance(hole_number, bool) or not isinstance(hole_number, int):
        raise ValueError("Hole number must be a whole number.")
    if not 1 <= hole_number <= hole_count:
        raise ValueError(f"Hole number must be between 1 and {hole_count}.")
    return hole_number


def compute_totals(scores: Sequence[HoleScoreLike], players: Sequence[str]) -> dict[str, int]:
    totals = {p: 0 for p in players}
    for s in scores:
        totals[s.player_name] = totals.get(s.player_name, 0) + s.strokes
    return totals


def next_cell(scores: Sequence[HoleScoreLike], players: Sequence[str], hole_count: int) -> tuple[int, str] | None:
    """First empty (hole, player) in guided order: every player on hole 1 in
    player order, then hole 2, and so on."""
    filled = {(s.hole_number, s.player_name) for s in scores}
    for hole in range(1, hole_count + 1):
        for player in players:
            if (hole, player) not in filled:
                return hole, player
    return None


def can_write(
    scores: Sequence[HoleScoreLike], players: Sequence[str], hole_count: int, hole_number: int, player_name: str
) -> bool:
    """A write is either a correction of a filled cell or the next empty one
    in guided order. Skipping ahead (hole 5 before hole 2) is refused."""
    if any(s.hole_number == hole_number and s.player_name == player_name for s in scores):
        return True
    return next_cell(scores, players, hole_count) == (hole_number, player_name)


def lowest(totals: dict[str, int], players: Sequence[str]) -> tuple[str, ...]:
    """Every player sharing the lowest total, in player order."""
    if not players:
        return ()
    best = min(totals[p] for p in players)
    return tuple(p for p in players if totals[p] == best)


def evaluate(scores: Sequence[HoleScoreLike], players: Sequence[str], hole_count: int) -> StrokePlayResult:
    totals = compute_totals(scores, players)
    cell = next_cell(scores, players, hole_count)

    if cell is None:
        return StrokePlayResult(status=STATUS_WON, totals=totals, leaders=lowest(totals, players))

    # Leader during play is judged only on holes everyone has finished: a
    # player who has just putted out hole 3 must not look worse than one who
    # hasn't played it yet.
    holes_by_player: dict[str, set[int]] = {p: set() for p in players}
    for s in scores:
        holes_by_player.setdefault(s.player_name, set()).add(s.hole_number)
    common = set.intersection(*holes_by_player.values()) if holes_by_player else set()
    if common:
        common_totals = compute_totals([s for s in scores if s.hole_number in common], players)
        leaders = lowest(common_totals, players)
    else:
        leaders = ()

    hole, player = cell
    return StrokePlayResult(
        status=STATUS_IN_PROGRESS, totals=totals, leaders=leaders, current_hole=hole, current_player=player
    )


def winner_text(winners: Sequence[str]) -> str:
    """What's stored in score_sheet_sessions.winner: the shared names on a
    tie ("Alex & Sam", "Alex, Sam & Jo")."""
    if len(winners) <= 1:
        return winners[0] if winners else ""
    return ", ".join(winners[:-1]) + " & " + winners[-1]
