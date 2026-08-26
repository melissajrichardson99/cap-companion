// Static content for the "Bingo Milestones" example card (Bingo page) -- the
// four illustrative 5x5 dot-grid diagrams and their descriptions. Filled-tile
// indices mirror the real detection logic in backend/app/services/milestone.py
// (ROWS/DIAGONAL_A/DIAGONAL_B/BLACKOUT) so each diagram matches what the app
// actually checks for, not an approximation.
//
// Reaching a milestone also unlocks one bonus minigame draw
// (backend/app/services/map_bingo.py) on top of the coins below -- keep
// bingoMilestoneCoinAmount in sync with backend/app/services/coins.py's
// bingo_milestone_amount().

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

const BINGO_MILESTONE_COIN_AMOUNTS: Record<BingoMilestoneExample['type'], number> = {
  line: 10,
  x: 25,
  double_bingo: 25,
  blackout: 50,
}

export function bingoMilestoneCoinAmount(type: BingoMilestoneExample['type']): number {
  return BINGO_MILESTONE_COIN_AMOUNTS[type]
}

// Split across two lines (minigame, then coins) rather than one long nowrap
// string -- a single line wide enough for "🎮 Bonus Minigame + 🪙 50 Cobb
// Coins" forced the grid cell (and the card around it) wider than intended.
export function bingoMilestoneRewardLines(type: BingoMilestoneExample['type']): [string, string] {
  return ['🎮 Bonus Minigame', `🪙 +${bingoMilestoneCoinAmount(type)} Cobb Coins`]
}
