import { test, expect } from '@playwright/test'

// Covers Cobb Coins (migration 011_cobb_coins.sql): coins awarded from two
// different source types (Puzzle Timer + Bingo Tile), the running total
// displaying correctly in the persistent header pill, and a collectible
// unlocking once the total crosses its threshold.
//
// Named to sort alphabetically before every other spec file (global setup
// resets coin_awards to empty once per run -- see global-setup.ts) so it
// runs against a running total of exactly 0, before any later spec's own
// puzzle/bingo/hunt/scoring completions add to the same ledger. Same
// single-worker, non-parallel run model every other spec here already
// depends on (see puzzle-timer.spec.ts's staff_time_seconds assumption).

test.describe('Cobb Coins', () => {
  test('two source types award coins, the running total updates, and a collectible unlocks at its threshold', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('.app-coin-total')).toHaveText('🪙 0')

    // Puzzle Timer: Math Maze "Standard", 0 hints used -> 12 coins (fewer
    // hints earns more, per coins.puzzle_timer_amount's hint-tier table).
    await page.getByRole('button', { name: 'Puzzles' }).click()
    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()
    const puzzleDialog = page.getByRole('dialog')
    await puzzleDialog.getByRole('button', { name: 'Start', exact: true }).click()
    await page.waitForTimeout(1200)
    await puzzleDialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await puzzleDialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(puzzleDialog.getByText('Hints used: 0/3')).toBeVisible()
    await expect(page.locator('.app-coin-total')).toHaveText('🪙 12')
    await page.keyboard.press('Escape') // close the puzzle result dialog

    // Bingo Tile: completing any open tile -> +2 coins. Also draws a
    // minigame (tech spec 4.1's "always 1 draw per completion"), which pops
    // an overlay unrelated to this test -- dismiss it the same way as the
    // puzzle dialog above.
    await page.getByRole('button', { name: 'Bingo Card' }).click()
    await page.locator('.bingo-tile-open').first().click()
    await expect(page.locator('.app-coin-total')).toHaveText('🪙 14')
    await page.keyboard.press('Escape')

    // Collectibles screen: Bronze Explorer's threshold (10) is now crossed
    // by the combined 14, Silver Adventurer's (30) is not.
    await page.getByRole('button', { name: 'Collectibles' }).click()
    await expect(page.getByText('🪙 14 Cobb Coins earned')).toBeVisible()

    const bronze = page.locator('.collectible-card', { hasText: 'Bronze Explorer' })
    await expect(bronze).toHaveClass(/collectible-unlocked/)
    await expect(bronze.getByText('Unlocked', { exact: true })).toBeVisible()

    const silver = page.locator('.collectible-card', { hasText: 'Silver Adventurer' })
    await expect(silver).toHaveClass(/collectible-locked/)
    await expect(silver.getByText('Unlock at 30 coins')).toBeVisible()
  })
})
