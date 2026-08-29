import { test, expect } from '@playwright/test'

// Covers the /scoring/:gameSlug and /puzzles/:challengeSlug direct deep
// links (QR signage at each game/puzzle), added alongside migration 032's
// slug columns. Mirrors our-animals-deep-link.spec.ts's cold-load shape --
// each `page.goto` below is a hard navigation, not in-app nav, matching a
// guest's camera app opening a printed sign's URL fresh.
//
// Unlike Our Animals (a full list->detail screen swap), Scoring/Puzzles keep
// their normal list screen mounted underneath and the deep link just
// auto-opens that game/challenge's existing popup on top of it -- so these
// tests assert the dialog opens with the right content, not that the list
// disappears.
//
// Named to sort well after cobb-coins.spec.ts (see
// cap-companion-e2e-alphabetical-ordering-gotcha); doesn't touch Hunt state,
// so no other ordering constraint applies.

test.describe('/scoring/:gameSlug direct deep link', () => {
  test('landing directly on a game via /scoring/:gameSlug opens that game\'s session modal', async ({ page }) => {
    await page.goto('/scoring/farm-toss')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Farm Toss', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Begin Session' })).toBeVisible()
    // The list underneath is still mounted (not swapped out like Animals).
    await expect(page.locator('.scoring-game-list')).toBeVisible()
  })

  test('an unknown game slug shows a clear not-found state, not a crash or blank screen', async ({ page }) => {
    await page.goto('/scoring/does-not-exist')

    await expect(page.getByText(/couldn't find that game/i)).toBeVisible()
    await expect(page.locator('.scoring-game-list')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Browse Scoring Games' }).click()
    await expect(page.locator('.scoring-game-list')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Scoring Sheet' })).toBeVisible()
  })
})

test.describe('/puzzles/:challengeSlug direct deep link', () => {
  test('landing directly on a challenge via /puzzles/:challengeSlug opens that challenge\'s modal', async ({
    page,
  }) => {
    await page.goto('/puzzles/math-maze-standard')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Math Maze — Standard')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
    await expect(page.locator('.puzzle-list')).toBeVisible()
  })

  test('an unknown challenge slug shows a clear not-found state, not a crash or blank screen', async ({ page }) => {
    await page.goto('/puzzles/does-not-exist')

    await expect(page.getByText(/couldn't find that puzzle challenge/i)).toBeVisible()
    await expect(page.locator('.puzzle-list')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Browse Puzzles' }).click()
    await expect(page.locator('.puzzle-list')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Floor Puzzles' })).toBeVisible()
  })
})
