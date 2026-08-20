// Static content for the "Bingo Milestones" example card (Bingo page) -- the
// four illustrative 5x5 dot-grid diagrams and their descriptions. Filled-tile
// indices mirror the real detection logic in backend/app/services/milestone.py
// (ROWS/DIAGONAL_A/DIAGONAL_B/BLACKOUT) so each diagram matches what the app
// actually checks for, not an approximation.
//
// Milestones don't award their own coin bonus today -- only individual tile
// completions do (BINGO_TILE_AMOUNT, backend/app/services/coins.py).
// Completing a milestone instead unlocks one bonus minigame draw
// (backend/app/services/map_bingo.py), which is what the reward text below
// reflects rather than an invented coin number.

export interface BingoMilestoneExample {
  type: 'line' | 'x' | 'double_bingo' | 'blackout'
  label: string
  description: string
  filledTiles: ReadonlySet<number>
}

const ROW_2 = [10, 11, 12, 13, 14]
const COL_2 = [2, 7, 12, 17, 22]
const DIAGONAL_A = [0, 6, 12, 18, 24]
const DIAGONAL_B = [4, 8, 12, 16, 20]

export const BINGO_MILESTONE_EXAMPLES: BingoMilestoneExample[] = [
  {
    type: 'line',
    label: 'Bingo',
    description: 'Complete 5 in a row or column.',
    filledTiles: new Set(ROW_2),
  },
  {
    type: 'x',
    label: 'X Marks the Spot',
    description: 'Complete both diagonals.',
    filledTiles: new Set([...DIAGONAL_A, ...DIAGONAL_B]),
  },
  {
    type: 'double_bingo',
    label: 'Double Bingo',
    description: 'Complete 1 row and 1 column at the same time.',
    filledTiles: new Set([...ROW_2, ...COL_2]),
  },
  {
    type: 'blackout',
    label: 'Blackout',
    description: 'Fill every space on the card.',
    filledTiles: new Set(Array.from({ length: 25 }, (_, i) => i)),
  },
]

export const BINGO_MILESTONE_REWARD_TEXT = '🎮 Bonus Minigame'
