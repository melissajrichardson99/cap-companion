import { test, expect } from '@playwright/test'

// Covers the Puzzle Solving Timer (Plan.md 2.3): start/stop timer per
// challenge, the 3-tap progressive hint button, and the leaderboard
// recording + displaying attempts. Assumes
// `python backend/scripts/reset_demo_data.py` has been run first (global
// setup does this), so puzzle_attempts starts empty each run.

test.describe('Puzzle Solving Timer', () => {
  test('lists all 6 puzzles with their challenge variants', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Puzzles' }).click()

    for (const name of [
      'Pyramid Puzzler',
      'Math Maze',
      'Hop Dots',
      'Right Turn Only',
      'Red White and Blue',
      'Big Mystery Maze',
    ]) {
      await expect(page.locator('.puzzle-name', { hasText: name })).toBeVisible()
    }

    const pyramidCard = page.locator('.puzzle-card', { hasText: 'Pyramid Puzzler' })
    await expect(pyramidCard.getByText('Reach the Top', { exact: true })).toBeVisible()
    await expect(pyramidCard.getByText('Reach the Top, Then Exit From Start')).toBeVisible()
    await expect(pyramidCard.getByText('All 4 Corners + Center, Then Exit')).toBeVisible()
  })

  test('timer starts, stops, records an attempt, and the attempt appears on the leaderboard', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Puzzles' }).click()

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Default' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Math Maze — Default')).toBeVisible()
    await expect(dialog.locator('.puzzle-timer-display')).toHaveText('0:00')
    await expect(dialog.getByText('No times recorded yet — be the first!')).toBeVisible()

    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    await page.waitForTimeout(1200)
    await expect(dialog.locator('.puzzle-timer-display')).not.toHaveText('0:00')

    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Restart' })).toBeVisible()

    const firstEntry = dialog.locator('.puzzle-leaderboard-entry').first()
    await expect(firstEntry).toBeVisible()
    await expect(firstEntry.locator('.puzzle-leaderboard-rank')).toHaveText('#1')
    await expect(firstEntry.locator('.puzzle-leaderboard-time')).toHaveText(/^0:0[1-9]$/)

    // "Today" scope should show the same freshly-recorded attempt.
    await dialog.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(dialog.locator('.puzzle-leaderboard-entry').first()).toBeVisible()
  })

  test('the 3-tap hint button reveals tiers progressively', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Puzzles' }).click()

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Default' }).click()

    const dialog = page.getByRole('dialog')
    const hintButton = dialog.getByRole('button', { name: /Show Hint|Show Full Solution/ })

    await expect(hintButton).toHaveText('Show Hint (1/3)')
    await expect(dialog.getByText(/not just where its arrow happens to point/)).not.toBeVisible()

    await hintButton.click()
    await expect(dialog.getByText(/not just where its arrow happens to point/)).toBeVisible()
    await expect(hintButton).toHaveText('Show Hint (2/3)')

    await hintButton.click()
    await expect(dialog.getByText('The first move is up 1, then left 1.')).toBeVisible()
    await expect(hintButton).toHaveText('Show Full Solution')

    await hintButton.click()
    await expect(dialog.getByText(/Finish \(8 moves total\)/)).toBeVisible()
    await expect(hintButton).toHaveCount(0)
  })

  test('a "none" solution puzzle has a timer and leaderboard but no hint button', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Puzzles' }).click()

    const mysteryCard = page.locator('.puzzle-card', { hasText: 'Big Mystery Maze' })
    await mysteryCard.getByRole('button', { name: 'Default' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Big Mystery Maze — Default')).toBeVisible()
    await expect(dialog.locator('.puzzle-timer-display')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Hints' })).toHaveCount(0)
    await expect(dialog.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()
  })
})
