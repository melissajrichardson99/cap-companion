import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page, type Response } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// Covers Family Passport (Plan.md 2.8, migration 013_family_passport.sql):
// the header action opens the same way as Contact Staff/Coins, generation
// works with and without the optional group photo, and the stats/title on
// the resulting card genuinely reflect completions made across bingo,
// puzzles, and scoring sheet -- not hardcoded/stale numbers. Hits the real
// dev Supabase project via the backend, same as the other e2e specs -- no
// mocking.
//
// Named to sort between contact-staff and favorite-photo, so in a full
// suite run only cobb-coins.spec.ts's 1 puzzle attempt + 1 bingo tile have
// landed before this file runs. The stats assertions below use before/after
// deltas (not absolute counts) specifically so this file's own checks are
// correct whether run standalone (clean DB) or as part of the full suite
// (some cumulative state already present) -- see PassportStats's snapshot
// design in app/services/passport.py.

interface PassportStats {
  scavenger_hunt_characters_completed: number
  scavenger_hunt_characters_total: number
  bingo_tiles_completed: number
  bingo_tiles_total: number
  scoring_sheet_games_won: number
  puzzle_challenges_completed: number
  total_cobb_coins: number
  title: string
}

interface PassportSession {
  id: string
  family_label: string
  photo_url: string | null
  stats: PassportStats
}

function passportDialog(page: Page) {
  return page.getByRole('dialog')
}

async function generatePassport(page: Page, familyLabel: string, photoPath?: string): Promise<PassportSession> {
  await page.getByRole('button', { name: 'Generate Passport' }).click()
  const dialog = passportDialog(page)
  await dialog.locator('.passport-family-label-input').fill(familyLabel)
  if (photoPath) {
    await dialog.locator('.passport-photo-label input[type="file"]').setInputFiles(photoPath)
  }

  const [response] = await Promise.all([
    page.waitForResponse(
      (res: Response) => res.url().includes('/passport/generate') && res.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Generate Passport' }).click(),
  ])
  const session = (await response.json()) as PassportSession
  await expect(dialog.locator('.passport-card-title')).toHaveText(session.stats.title)
  return session
}

test.describe('Family Passport', () => {
  test('generates without a photo -- the card renders with no photo element', async ({ page }) => {
    await page.goto('/')
    const session = await generatePassport(page, `No Photo Family ${Date.now()}`)

    expect(session.photo_url).toBeNull()
    const dialog = passportDialog(page)
    await expect(dialog.locator('.passport-card-photo')).toHaveCount(0)
    await expect(dialog.getByText(session.family_label)).toBeVisible()

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('generates with a group photo -- the card displays it', async ({ page }) => {
    await page.goto('/')
    const session = await generatePassport(page, `Photo Family ${Date.now()}`, FIXTURE_PHOTO)

    expect(session.photo_url).not.toBeNull()
    const dialog = passportDialog(page)
    await expect(dialog.locator('.passport-card-photo')).toHaveAttribute('src', session.photo_url!)
  })

  test('stats reflect real completions across bingo, puzzles, and scoring sheet, and the title follows the strongest category', async ({
    page,
  }) => {
    await page.goto('/')

    // Baseline: whatever's already true of the shared demo data before this
    // test's own actions below (0 in a standalone run, or a little
    // cobb-coins.spec.ts residue in a full suite run -- either way, the
    // assertions after only check that these specific numbers went UP).
    const baseline = await generatePassport(page, 'Stats Baseline Check')
    await passportDialog(page).getByRole('button', { name: 'Close' }).click()

    // Bingo: complete any one open tile (+2 coins, same "first open tile"
    // approach as cobb-coins.spec.ts -- the exact tile doesn't matter here).
    await page.getByRole('button', { name: 'Bingo Card' }).click()
    await page.locator('.bingo-tile-open').first().click()
    await page.getByRole('button', { name: 'Completed Challenge' }).click()
    // Completing a tile draws a minigame asynchronously. Dismiss it via the
    // overlay's own close button, not Escape -- the Godot iframe grabs
    // keyboard focus once it loads, so an Escape keypress from here can
    // land on the iframe's own document instead of bubbling to the parent
    // page's listener, leaving the overlay stuck open and blocking every
    // click underneath it for the rest of the test.
    await page.getByRole('button', { name: 'Close minigame' }).click()
    await expect(page.locator('.minigame-overlay')).toHaveCount(0)

    // Puzzle Timer: "Right Turn Only" -- untouched by puzzle-timer.spec.ts
    // (which only exercises Math Maze / Big Mystery Maze), so no risk of
    // double-counting an already-completed attempt from that file.
    await page.getByRole('button', { name: 'Puzzles' }).click()
    const rightTurnCard = page.locator('.puzzle-card', { hasText: 'Right Turn Only' })
    await rightTurnCard.getByRole('button', { name: 'Standard' }).click()
    const puzzleDialog = page.getByRole('dialog')
    await puzzleDialog.getByRole('button', { name: 'Start', exact: true }).click()
    await page.waitForTimeout(1200)
    await puzzleDialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await puzzleDialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await page.keyboard.press('Escape')

    // Scoring Sheet: win "Cornhole Extreme" (first_to 21, auto-locks on
    // win -- no separate Finish Game tap needed) -- untouched by
    // scoring-sheet.spec.ts (Farm Toss/Horse Hoops/Cornhole/Tiki Toss only).
    await page.getByRole('button', { name: 'Scoring Sheet' }).click()
    const cornholeExtremeCard = page
      .locator('.scoring-game-card')
      .filter({ has: page.getByRole('heading', { name: 'Cornhole Extreme', exact: true }) })
    await cornholeExtremeCard.getByRole('button', { name: 'Start Scoring' }).click()
    const scoringDialog = page.getByRole('dialog')
    await scoringDialog.locator('.scoring-player-input').first().fill('Guest')
    await scoringDialog.getByRole('button', { name: 'Begin Session' }).click()
    const scoreButton = (label: string) => scoringDialog.getByRole('button', { name: label, exact: true })
    for (let i = 0; i < 5; i++) await scoreButton('Third Hole (+4)').click() // 20
    await scoreButton('Woody (+1)').click() // 21 -- win
    await expect(scoringDialog.locator('.scoring-win-headline')).toContainText('Guest wins!')
    await page.keyboard.press('Escape')

    const final = await generatePassport(page, 'Stats Final Check')

    expect(final.stats.bingo_tiles_completed).toBeGreaterThan(baseline.stats.bingo_tiles_completed)
    expect(final.stats.puzzle_challenges_completed).toBeGreaterThan(baseline.stats.puzzle_challenges_completed)
    expect(final.stats.scoring_sheet_games_won).toBeGreaterThan(baseline.stats.scoring_sheet_games_won)
    expect(final.stats.total_cobb_coins).toBeGreaterThan(baseline.stats.total_cobb_coins)

    // Fixed denominators regardless of how much cumulative state exists.
    expect(final.stats.scavenger_hunt_characters_total).toBe(5)
    expect(final.stats.bingo_tiles_total).toBe(25)

    // This test deliberately touches only bingo/puzzle/scoring, winning
    // exactly 1 scoring sheet game -- 1/3 against the scoring reference
    // count outweighs 1 more bingo tile (out of 25) or 1 more puzzle
    // challenge (out of 9) could ever contribute on their own, so scoring
    // should come out strongest regardless of any earlier-spec residue.
    expect(final.stats.title).toBe('Sharpshooter Family')
  })
})
