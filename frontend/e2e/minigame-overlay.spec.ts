import { test, expect, type Page } from '@playwright/test'
import { minigameFrame, postFromMinigame } from './minigameHelper'
import { openTab } from './navMenuHelper'

// Covers MinigameOverlay's per-launch behaviour when more than one minigame is
// queued. Marking Arcade Pad visited and confirming two of its child tiles is
// the real guest path that queues two base minigames back to back (one per
// tile completion). Each test uses page's own auto-minted device session, so
// every tile starts open.

async function visitArcadePadConfirmingTwoTiles(page: Page): Promise<void> {
  await page.goto('/')
  await openTab(page, 'Map')
  await page.locator('.map-pin[aria-label^="Arcade Pad"]').click()
  await page.getByRole('button', { name: 'Mark Visited' }).click()
  await page.getByRole('button', { name: 'Yes' }).click()
  await page.getByRole('button', { name: 'Yes' }).click()
  await page.getByRole('button', { name: 'No' }).click()
  await page.getByRole('button', { name: 'No' }).click()
}

// The draw is random, so force the second completion to draw the same game
// as the first. Everything else in the response is the real backend's.
async function forceSameGameTwice(page: Page): Promise<void> {
  await page.route('**/map/nodes/*/visit', async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    const [first, second] = json.tile_completions
    if (first && second) second.minigames_drawn[0] = first.minigames_drawn[0]
    await route.fulfill({ response, json })
  })
}

test.describe('MinigameOverlay launches', () => {
  test('closing one launch twice is a no-op and does not skip the next queued game', async ({ page }) => {
    await visitArcadePadConfirmingTwoTiles(page)
    const frame = page.locator('.minigame-overlay-frame')
    await expect(frame).toBeVisible({ timeout: 15_000 })

    // Two closes for the first launch, delivered back to back (e.g. the
    // game's Exit and an Escape landing together).
    await postFromMinigame(page, { type: 'minigame-complete' }, { type: 'minigame-complete' })
    await page.waitForTimeout(500)

    // The second queued game must still be showing...
    await expect(frame).toBeVisible()
    // ...and closing it is what empties the queue.
    await postFromMinigame(page, { type: 'minigame-complete' })
    await expect(page.locator('.minigame-overlay')).toHaveCount(0)
  })

  test('the same game queued twice in a row reloads for the second launch', async ({ page }) => {
    await forceSameGameTwice(page)
    await visitArcadePadConfirmingTwoTiles(page)
    await expect(page.locator('.minigame-overlay-frame')).toBeVisible({ timeout: 15_000 })

    // Tag the first launch's document. If the second launch reused the same
    // iframe (no reload), the tag would still be there -- that's the guest
    // seeing the first game's finished screen instead of a fresh round.
    const first = await minigameFrame(page)
    await first.waitForLoadState('load')
    await first.evaluate(() => {
      ;(window as unknown as { __firstLaunch: boolean }).__firstLaunch = true
    })
    const src = await page.locator('.minigame-overlay-frame').getAttribute('src')

    await postFromMinigame(page, { type: 'minigame-complete' })
    await page.waitForTimeout(500)

    await expect(page.locator('.minigame-overlay-frame')).toHaveAttribute('src', src!)
    const second = await minigameFrame(page)
    await second.waitForLoadState('load')
    expect(await second.evaluate(() => (window as unknown as { __firstLaunch?: boolean }).__firstLaunch ?? false)).toBe(
      false,
    )

    await postFromMinigame(page, { type: 'minigame-complete' })
    await expect(page.locator('.minigame-overlay')).toHaveCount(0)
  })
})
