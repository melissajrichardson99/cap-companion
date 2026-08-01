import { test, expect } from '@playwright/test'

// Covers the new parent/child map node behavior: Cornhole, Cornhole Extreme,
// Horse Hoops, and Tiki Toss/Ring & Hook are sub-games of Arcade Pad and
// should never appear as their own pin or fallback-list card; Arcade Pad's
// popup should list them and the "did you complete X here?" sequence should
// walk their linked bingo tiles.
//
// Assumes `python backend/scripts/reset_demo_data.py` has been run first so
// the Demo Family card/map nodes start from a known (all-incomplete) state.

test.describe('Arcade Pad parent/child interconnectivity', () => {
  test('children are hidden as standalone nodes and reachable only via the parent popup', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('.map-pin[aria-label^="Arcade Pad"]')).toBeVisible()

    // None of the 4 Arcade Pad children render their own pin...
    for (const child of ['Cornhole', 'Cornhole Extreme', 'Horse Hoops', 'Tiki Toss/Ring & Hook']) {
      await expect(page.locator(`.map-pin[aria-label^="${child} ("]`)).toHaveCount(0)
    }

    // ...nor a "More Locations" fallback card.
    await expect(page.locator('.node-card-name', { hasText: /^Cornhole$/ })).toHaveCount(0)
    await expect(page.locator('.node-card-name', { hasText: /^Cornhole Extreme$/ })).toHaveCount(0)
    await expect(page.locator('.node-card-name', { hasText: /^Horse Hoops$/ })).toHaveCount(0)
    await expect(page.locator('.node-card-name', { hasText: /^Tiki Toss\/Ring & Hook$/ })).toHaveCount(0)

    await page.locator('.map-pin[aria-label^="Arcade Pad"]').click()
    await expect(page.getByText('Games here: Cornhole, Cornhole Extreme, Horse Hoops, Tiki Toss/Ring & Hook')).toBeVisible()
  })

  test('marking Arcade Pad visited walks through each child\'s linked bingo tile', async ({ page }) => {
    await page.goto('/')
    await page.locator('.map-pin[aria-label^="Arcade Pad"]').click()
    await page.getByRole('button', { name: 'Mark Visited' }).click()

    // 4 children -> 4 confirm steps, one per linked tile. The popup renders
    // curly quotes (&ldquo;/&rdquo;) around the tile label, not straight ones.
    await expect(page.getByText('Tile 1 of 4')).toBeVisible()
    await expect(page.getByText(/Did you complete .*Win a round at Cornhole.* here\?/)).toBeVisible()
    await page.getByRole('button', { name: 'Yes' }).click()

    await expect(page.getByText('Tile 2 of 4')).toBeVisible()
    await expect(page.getByText(/Did you complete .*Take on Cornhole Extreme.* here\?/)).toBeVisible()
    await page.getByRole('button', { name: 'Yes' }).click()

    await expect(page.getByText('Tile 3 of 4')).toBeVisible()
    await expect(page.getByText(/Did you complete .*Score big at Horse Hoops.* here\?/)).toBeVisible()
    await page.getByRole('button', { name: 'No' }).click()

    await expect(page.getByText('Tile 4 of 4')).toBeVisible()
    await expect(page.getByText(/Did you complete .*Land a Bimini at Tiki Toss \/ Ring & Hook.* here\?/)).toBeVisible()
    await page.getByRole('button', { name: 'No' }).click()

    // Popup closes after the last answer; Arcade Pad's pin now shows visited
    // state plus a badge for the 2 children tiles still uncompleted.
    await expect(page.locator('.map-pin.map-pin-visited[aria-label^="Arcade Pad"]')).toBeVisible()
    await expect(page.locator('.map-pin[aria-label^="Arcade Pad"] .map-pin-tile-badge')).toHaveText('2')

    // Each of the 2 confirmed tile completions draws a minigame overlay;
    // dismiss whatever queued up before switching tabs.
    while (await page.locator('.minigame-overlay-close').isVisible().catch(() => false)) {
      await page.locator('.minigame-overlay-close').click()
    }

    await page.getByRole('button', { name: 'Bingo Card' }).click()
    await expect(page.locator('.bingo-tile', { hasText: 'Win a round at Cornhole' })).toHaveClass(/bingo-tile-completed/)
    await expect(page.locator('.bingo-tile', { hasText: 'Take on Cornhole Extreme' })).toHaveClass(/bingo-tile-completed/)
    await expect(page.locator('.bingo-tile', { hasText: 'Score big at Horse Hoops' })).toHaveClass(/bingo-tile-open/)
  })
})
