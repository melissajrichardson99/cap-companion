import { test, expect, type Locator } from '@playwright/test'
import { seedDeviceSession } from './deviceSessionHelper'

// Turn-based Scoring Sheet resume: a session in progress survives a reload
// (deep link) and closing/reopening the sheet from its card, by asking the
// backend for this device's unfinished session of the game
// (GET /scoring/games/{id}/active-session) -- before this, the modal held
// the session only in React state and a reload dropped back to setup.
// Fresh device session per test, so nothing leaks into other specs.

function currentPlayer(dialog: Locator): Locator {
  return dialog.locator('.scoring-current-player-panel .scoring-player-name')
}

function runningScore(dialog: Locator, player: string): Locator {
  return dialog.locator('.scoring-running-scores tr', { hasText: player }).locator('.scoring-final-totals-score')
}

test.describe('Scoring Sheet resume (turn-based)', () => {
  test('a Farm Toss game in progress resumes after a reload and after reopening from its card', async ({ page }) => {
    await seedDeviceSession(page, crypto.randomUUID())
    await page.goto('/scoring/farm-toss')
    const dialog = page.getByRole('dialog')
    const inputs = dialog.locator('.scoring-player-input')
    await inputs.nth(0).fill('Alice')
    await inputs.nth(1).fill('Bob')
    await dialog.getByRole('button', { name: 'Begin Session' }).click()

    await dialog.getByRole('button', { name: '6-Point Ring (+6)' }).click()
    await expect(currentPlayer(dialog)).toHaveText("Bob's turn")
    await dialog.getByRole('button', { name: '2-Point Ring (+2)' }).click()
    await expect(currentPlayer(dialog)).toHaveText("Alice's turn")
    await dialog.getByRole('button', { name: '3-Point Ring (+3)' }).click()
    await expect(currentPlayer(dialog)).toHaveText("Bob's turn")

    await page.reload()
    await expect(currentPlayer(dialog)).toHaveText("Bob's turn")
    await expect(runningScore(dialog, 'Alice')).toHaveText('9')
    await expect(runningScore(dialog, 'Bob')).toHaveText('2')
    await expect(dialog.getByRole('button', { name: 'Begin Session' })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page
      .locator('.scoring-game-card')
      .filter({ has: page.getByRole('heading', { name: 'Farm Toss', exact: true }) })
      .getByRole('button', { name: 'Start Scoring' })
      .click()
    await expect(currentPlayer(dialog)).toHaveText("Bob's turn")
    await dialog.getByRole('button', { name: 'Miss' }).click()
    await expect(currentPlayer(dialog)).toHaveText("Alice's turn")
    await expect(runningScore(dialog, 'Bob')).toHaveText('2')
  })

  test('a finished game is not resumed: reopening starts a new session', async ({ page }) => {
    await seedDeviceSession(page, crypto.randomUUID())
    await page.goto('/scoring/farm-toss')
    const dialog = page.getByRole('dialog')
    await dialog.locator('.scoring-player-input').nth(0).fill('Solo')
    await dialog.getByRole('button', { name: 'Remove player 2' }).click()
    await dialog.getByRole('button', { name: 'Begin Session' }).click()
    for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: '6-Point Ring (+6)' }).click()
    await expect(dialog.locator('.milestone-banner-blackout')).toContainText('Solo wins!')

    await page.reload()
    await expect(dialog.getByRole('button', { name: 'Begin Session' })).toBeVisible()
  })
})
