"""Pure win-condition detection for the Scoring Sheet — Plan.md 2.2.

No I/O and no framework dependency, same discipline as milestone.py: given a
chronological list of score entries and a game's win-condition config,
decide whether/who has won. Kept pure and independently testable so the
game-specific tie rules (Horse Hoops' bonus round, Tiki Toss's round-based
tiebreak) are exercised directly, not just eyeballed through the UI --
exactly the "exact math, not approximate" standard the known pitfalls call
for elsewhere in this app.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

FIRST_TO = "first_to"
FIRST_TO_BONUS_ROUND = "first_to_bonus_round"
FIRST_TO_ROUND_TIEBREAK = "first_to_round_tiebreak"

STATUS_IN_PROGRESS = "in_progress"
STATUS_WON = "won"
STATUS_TIE_BONUS_ROUND = "tie_bonus_round"
STATUS_TIE_ROUND_PENDING = "tie_round_pending"


@dataclass(frozen=True)
class ScoreEntryLike:
    player_name: str
    point_value: int


@dataclass(frozen=True)
class WinCheckResult:
    status: str  # STATUS_* above
    totals: dict[str, int]
    winner: str | None = None
    tied_players: tuple[str, ...] = ()
    # Only meaningful for round-based games: the round the result was
    # decided on (status == won), or the number of rounds completed so far
    # (status in {in_progress, tie_round_pending}).
    round_number: int | None = None


def compute_totals(entries: Sequence[ScoreEntryLike], players: Sequence[str]) -> dict[str, int]:
    totals = {p: 0 for p in players}
    for e in entries:
        totals[e.player_name] = totals.get(e.player_name, 0) + e.point_value
    return totals


def _evaluate_first_to(entries: Sequence[ScoreEntryLike], players: Sequence[str], threshold: int) -> WinCheckResult:
    totals = {p: 0 for p in players}
    for e in entries:
        totals[e.player_name] = totals.get(e.player_name, 0) + e.point_value
        if totals[e.player_name] >= threshold:
            return WinCheckResult(status=STATUS_WON, totals=dict(totals), winner=e.player_name)
    return WinCheckResult(status=STATUS_IN_PROGRESS, totals=totals)


def _evaluate_first_to_bonus_round(
    entries: Sequence[ScoreEntryLike], players: Sequence[str], threshold: int
) -> WinCheckResult:
    # Unlike _evaluate_first_to, this can't stop at the first entry that
    # crosses the threshold: real play is simultaneous team play, not a
    # strict turn order, so "who crossed first" isn't meaningful -- only the
    # current totals are. Evaluating the full running total after every
    # entry (rather than bailing out at the first crossing) is also what
    # makes an actual tie reachable at all: if a win were declared the
    # instant any one team first reached the threshold, a second team could
    # never be given the chance to catch up and tie, and "bonus round on a
    # tie" would be dead code.
    totals = {p: 0 for p in players}
    for e in entries:
        totals[e.player_name] = totals.get(e.player_name, 0) + e.point_value

    max_total = max(totals.values(), default=0)
    if max_total < threshold:
        return WinCheckResult(status=STATUS_IN_PROGRESS, totals=totals)

    leaders = tuple(sorted(p for p, t in totals.items() if t == max_total))
    if len(leaders) == 1:
        return WinCheckResult(status=STATUS_WON, totals=dict(totals), winner=leaders[0])
    return WinCheckResult(status=STATUS_TIE_BONUS_ROUND, totals=totals, tied_players=leaders)


def _evaluate_round_tiebreak(
    entries: Sequence[ScoreEntryLike], players: Sequence[str], threshold: int, throws_per_round: int
) -> WinCheckResult:
    running = {p: 0 for p in players}
    throw_count = {p: 0 for p in players}
    round_totals: dict[str, list[int]] = {p: [] for p in players}

    for e in entries:
        running[e.player_name] = running.get(e.player_name, 0) + e.point_value
        throw_count[e.player_name] = throw_count.get(e.player_name, 0) + 1
        if e.player_name in round_totals and throw_count[e.player_name] % throws_per_round == 0:
            round_totals[e.player_name].append(running[e.player_name])

    # Only rounds every player has completed can be judged -- Tiki Toss's
    # "same round" comparison is meaningless until everyone has thrown their
    # 10 for that round.
    num_common_rounds = min((len(round_totals[p]) for p in players), default=0)
    tied_players: tuple[str, ...] = ()

    for round_idx in range(num_common_rounds):
        scores_this_round = {p: round_totals[p][round_idx] for p in players}
        qualifiers = {p: s for p, s in scores_this_round.items() if s >= threshold}
        if not qualifiers:
            continue

        max_score = max(qualifiers.values())
        leaders = tuple(sorted(p for p, s in qualifiers.items() if s == max_score))
        if len(leaders) == 1:
            return WinCheckResult(
                status=STATUS_WON, totals=dict(running), winner=leaders[0], round_number=round_idx + 1
            )
        tied_players = leaders

    if tied_players:
        return WinCheckResult(
            status=STATUS_TIE_ROUND_PENDING, totals=running, tied_players=tied_players, round_number=num_common_rounds
        )
    return WinCheckResult(status=STATUS_IN_PROGRESS, totals=running, round_number=num_common_rounds)


def evaluate_win(
    *,
    win_condition_type: str,
    entries: Sequence[ScoreEntryLike],
    players: Sequence[str],
    threshold: int,
    throws_per_round: int | None = None,
) -> WinCheckResult:
    if win_condition_type == FIRST_TO:
        return _evaluate_first_to(entries, players, threshold)
    if win_condition_type == FIRST_TO_BONUS_ROUND:
        return _evaluate_first_to_bonus_round(entries, players, threshold)
    if win_condition_type == FIRST_TO_ROUND_TIEBREAK:
        if not throws_per_round:
            raise ValueError("throws_per_round is required for first_to_round_tiebreak games")
        return _evaluate_round_tiebreak(entries, players, threshold, throws_per_round)
    raise ValueError(f"Unknown win_condition_type: {win_condition_type}")
