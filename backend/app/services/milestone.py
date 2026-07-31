"""Pure milestone detection logic — tech spec section 4.2.

No I/O and no framework dependency, kept pure on purpose: the exact
tile-index math is precisely what broke in a prior no-code attempt at this
app, so it needs to be trivially unit-testable without a database or web
framework anywhere in the loop.
"""

from dataclasses import dataclass

GRID_SIZE = 5
TILE_COUNT = GRID_SIZE * GRID_SIZE  # 25

ROWS: list[frozenset[int]] = [
    frozenset(range(r * GRID_SIZE, r * GRID_SIZE + GRID_SIZE)) for r in range(GRID_SIZE)
]
COLS: list[frozenset[int]] = [
    frozenset(range(c, TILE_COUNT, GRID_SIZE)) for c in range(GRID_SIZE)
]
# Line index 0-4 = rows 0-4, line index 5-9 = cols 0-4 (10 lines total).
# This indexing is the one persisted in bingo_cards.milestone_lines.
LINES: list[frozenset[int]] = ROWS + COLS

DIAGONAL_A = frozenset({0, 6, 12, 18, 24})  # row == col
DIAGONAL_B = frozenset({4, 8, 12, 16, 20})  # row + col == 4
X_SHAPE = DIAGONAL_A | DIAGONAL_B  # 9 unique tiles — index 12 is shared by both diagonals

BLACKOUT = frozenset(range(TILE_COUNT))


@dataclass(frozen=True)
class MilestoneHit:
    type: str  # "line" | "x" | "blackout"
    message: str
    tile_indices: tuple[int, ...]
    line_index: int | None = None  # only set for type == "line"


def detect_new_milestones(
    completed_indices: set[int],
    *,
    achieved_lines: set[int],
    achieved_x: bool,
    achieved_blackout: bool,
) -> list[MilestoneHit]:
    """Return the milestones newly satisfied by the given completed-tile set.

    Must be called after *every* tile completion, never periodically.
    Returns every shape newly satisfied by this exact completed set (not
    just the first one found) so a single completion that closes more than
    one shape at once can queue multiple milestone messages instead of
    dropping one.
    """
    hits: list[MilestoneHit] = []

    for line_index, line in enumerate(LINES):
        if line_index in achieved_lines:
            continue
        if line <= completed_indices:
            hits.append(
                MilestoneHit(
                    type="line",
                    message="BINGO",
                    tile_indices=tuple(sorted(line)),
                    line_index=line_index,
                )
            )

    if not achieved_x and X_SHAPE <= completed_indices:
        hits.append(
            MilestoneHit(type="x", message="X MARKS THE SPOT", tile_indices=tuple(sorted(X_SHAPE)))
        )

    if not achieved_blackout and BLACKOUT <= completed_indices:
        hits.append(
            MilestoneHit(type="blackout", message="BLACKOUT", tile_indices=tuple(sorted(BLACKOUT)))
        )

    return hits
