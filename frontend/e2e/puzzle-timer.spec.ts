import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { openTab } from './navMenuHelper'

// Covers the Puzzle Solving Timer (Plan.md 2.3): the description-only start
// screen, start/stop timer per challenge, the 3-tap progressive hint button,
// the Yes/No "did you complete it?" branch after Stop, and the result
// screen's staff-time comparison (both faster/slower and the "no staff time
// set yet" fallback). Assumes `python backend/scripts/reset_demo_data.py`
// has been run first (global setup does this), so puzzle_attempts starts
// empty and Math Maze's "Standard" challenge has staff_time_seconds = 2
// each run.
//
// The guest nav is a closed-by-default hamburger dropdown -- every test
// opens it first via "Open menu", then picks Puzzles via its menuitemradio
// role (not the implicit button role), per NavMenu.tsx.
//
// Per-Device Sessions Phase 2 (migration 025): puzzle_attempts is now scoped
// to a device session, same deviceSessionHelper.ts pattern established for
// Coins/Collectibles in Phase 1. openPuzzlesTab mints and seeds an explicit
// token for every test (rather than relying on the frontend's own implicit
// crypto.randomUUID() mint) and returns it, so a test that needs to make raw
// API calls in the same session as its own `page` can do so via withSession.

const API = 'http://localhost:8000'

async function openPuzzlesTab(page: Page, token: string = crypto.randomUUID()): Promise<string> {
  await seedDeviceSession(page, token)
  await page.goto('/')
  await openTab(page, 'Puzzles')
  return token
}

async function getCoinsTotal(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withSession(token))
  const body = (await res.json()) as { total: number }
  return body.total
}

test.describe('Puzzle Solving Timer', () => {
  test('lists all 6 puzzles with their relabeled challenge variants', async ({ page }) => {
    await openPuzzlesTab(page)

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
    await expect(pyramidCard.getByRole('button', { name: 'Challenge 1', exact: true })).toBeVisible()
    await expect(pyramidCard.getByRole('button', { name: 'Challenge 2', exact: true })).toBeVisible()
    await expect(pyramidCard.getByRole('button', { name: 'Challenge 3', exact: true })).toBeVisible()

    const hopDotsCard = page.locator('.puzzle-card', { hasText: 'Hop Dots' })
    await expect(hopDotsCard.getByRole('button', { name: 'Challenge 1', exact: true })).toBeVisible()
    await expect(hopDotsCard.getByRole('button', { name: 'Challenge 2', exact: true })).toBeVisible()

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await expect(mathMazeCard.getByRole('button', { name: 'Standard', exact: true })).toBeVisible()
  })

  test('start screen shows the challenge description, hidden once the timer is running', async ({ page }) => {
    await openPuzzlesTab(page)

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Math Maze — Standard')).toBeVisible()
    const description = dialog.getByText(
      'Navigate from the start square to the finish square, moving in a straight line the number of tiles marked on your current tile.',
    )
    await expect(description).toBeVisible()

    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(description).not.toBeVisible()
  })

  test('Stop asks Yes/No; No discards the attempt and returns to the start screen', async ({ page }) => {
    await openPuzzlesTab(page)

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    await page.waitForTimeout(1200)
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()

    await expect(dialog.getByText('Did you complete the puzzle?')).toBeVisible()
    await dialog.getByRole('button', { name: 'No', exact: true }).click()

    // Back on the start screen: description visible again, timer reset.
    await expect(
      dialog.getByText(
        'Navigate from the start square to the finish square, moving in a straight line the number of tiles marked on your current tile.',
      ),
    ).toBeVisible()
    await expect(dialog.locator('.puzzle-timer-display')).toHaveText('0:00')
    await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
  })

  test('Yes records the attempt and shows a faster-than-staff-time comparison', async ({ page }) => {
    await openPuzzlesTab(page)

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    // ~1s elapsed vs. staff_time_seconds = 2 -> 1 second faster.
    await page.waitForTimeout(1200)
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()

    await expect(dialog.locator('.puzzle-result-time')).toHaveText('0:01')
    await expect(dialog.getByText('1 second faster than staff time.')).toBeVisible()
    await expect(dialog.getByText('Hints used: 0/3')).toBeVisible()
  })

  test('Yes shows a slower-than-staff-time comparison when elapsed exceeds staff time', async ({ page }) => {
    await openPuzzlesTab(page)

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    // ~3s elapsed vs. staff_time_seconds = 2 -> 1 second slower.
    await page.waitForTimeout(3200)
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()

    await expect(dialog.locator('.puzzle-result-time')).toHaveText('0:03')
    await expect(dialog.getByText('1 second slower than staff time.')).toBeVisible()

    // "Try Again" goes back to a fresh start screen.
    await dialog.getByRole('button', { name: 'Try Again' }).click()
    await expect(dialog.locator('.puzzle-timer-display')).toHaveText('0:00')
    await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
  })

  test('a challenge with no staff time set shows the guest time with a fallback note, not a comparison', async ({
    page,
  }) => {
    await openPuzzlesTab(page)

    const mysteryCard = page.locator('.puzzle-card', { hasText: 'Big Mystery Maze' })
    await mysteryCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    await page.waitForTimeout(1200)
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()

    await expect(dialog.locator('.puzzle-result-time')).toHaveText('0:01')
    await expect(dialog.getByText('No staff time set for this one yet.')).toBeVisible()
    await expect(dialog.getByText(/faster than staff time|slower than staff time/)).toHaveCount(0)
  })

  test('the 3-tap hint button reveals tiers progressively while running, and hints-used reflects only the current run', async ({
    page,
  }) => {
    await openPuzzlesTab(page)

    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Hints' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    const hintButton = dialog.getByRole('button', { name: /Show Hint|Show Full Solution/ })

    await expect(hintButton).toHaveText('Show Hint (1/3)')
    await expect(dialog.getByText(/not just where its arrow happens to point/)).not.toBeVisible()

    await hintButton.click()
    await expect(dialog.getByText(/not just where its arrow happens to point/)).toBeVisible()
    await expect(hintButton).toHaveText('Show Hint (2/3)')

    await hintButton.click()
    await expect(dialog.getByText('The first move is up 1, then left 1.')).toBeVisible()

    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(dialog.getByText('Hints used: 2/3')).toBeVisible()

    // A fresh run afterward starts the hint count back at 0, not carried over.
    await dialog.getByRole('button', { name: 'Try Again' }).click()
    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Show Hint (1/3)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(dialog.getByText('Hints used: 0/3')).toBeVisible()
  })

  test('a "none" solution puzzle has a timer but no hint button, ever', async ({ page }) => {
    await openPuzzlesTab(page)

    const mysteryCard = page.locator('.puzzle-card', { hasText: 'Big Mystery Maze' })
    await mysteryCard.getByRole('button', { name: 'Standard' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Big Mystery Maze — Standard')).toBeVisible()
    await expect(dialog.locator('.puzzle-timer-display')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Hints' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Hints' })).toHaveCount(0)
  })

  test('two independent device sessions have completely independent Puzzle Timer attempts', async ({ request }) => {
    // puzzle_attempts has no read-back-by-session endpoint (no leaderboard,
    // per the module docstring), so the coin ledger -- itself tagged with
    // the same session_id at the same insert -- is the observable proxy for
    // "did this device's attempt get recorded," same reasoning
    // collectible-cards.spec.ts's isolation test uses for its own ledger.
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()

    const puzzlesRes = await request.get(`${API}/puzzles`)
    const puzzles = (await puzzlesRes.json()) as { challenges: { id: string }[] }[]
    const challengeId = puzzles[0].challenges[0].id

    expect(await getCoinsTotal(request, tokenA)).toBe(0)
    expect(await getCoinsTotal(request, tokenB)).toBe(0)

    const attemptRes = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
      ...withSession(tokenA),
      data: { elapsed_seconds: 10, hints_used: 0 },
    })
    expect(attemptRes.ok()).toBe(true)

    const totalA = await getCoinsTotal(request, tokenA)
    expect(totalA).toBeGreaterThan(0)
    // Session B's ledger is untouched by A's attempt.
    expect(await getCoinsTotal(request, tokenB)).toBe(0)

    // Session B recording its own attempt doesn't affect A's already-earned total.
    const attemptResB = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
      ...withSession(tokenB),
      data: { elapsed_seconds: 10, hints_used: 0 },
    })
    expect(attemptResB.ok()).toBe(true)
    expect(await getCoinsTotal(request, tokenB)).toBeGreaterThan(0)
    expect(await getCoinsTotal(request, tokenA)).toBe(totalA)
  })
})
