import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { openNavMenu } from './navMenuHelper'

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
// Every stat this rollup reads (Coins, Puzzle Timer, Bingo, and now
// Scavenger Hunt as of Phase 6b) is scoped to device_session_id, so this
// file's own fresh random tokens never see any other spec file's state
// regardless of run order -- unlike before Phase 6b, when Hunt's still-global
// progress meant a fresh token here could still observe another file's Hunt
// completions. The stats assertions below still use before/after deltas
// (not absolute counts) rather than relying on that isolation alone -- see
// PassportStats's snapshot design in app/services/passport.py.
//
// Per-Device Sessions Phase 4 (migration 027): passport_sessions is now
// scoped to the calling device (attribution only -- see that migration's
// header for why it's deliberately NOT wired into Reset Session), and
// _compute_stats' Scoring Sheet / Puzzle Timer reads are now correctly
// scoped to device_session_id too (Coins already was, since Phase 1; Bingo
// joined them in Phase 6a; Scavenger Hunt joined them in Phase 6b, migration
// 030, the final phase). Every UI-driven test below explicitly seeds a
// device-session token first, same deviceSessionHelper.ts pattern
// established for Coins/Collectibles/Puzzle Timer/Scoring Sheet, so a test
// needing raw API calls in the same session as its own `page` can do so via
// withSession(token).

const API = 'http://localhost:8000'

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

// Guest nav lives in a hamburger dropdown that starts closed on every fresh
// page load and re-closes itself after every selection -- see
// cap-companion-nav-menu-e2e-regression memory. Every nav-driven navigation
// below needs this clicked immediately first.
// Seeds a device-session token before first navigation (must happen before
// page.goto -- see deviceSessionHelper.ts) and returns it, so a test that
// also needs raw API calls (e.g. the isolation test below) can attach the
// same token via withSession().
async function openApp(page: Page, token: string = crypto.randomUUID()): Promise<string> {
  await seedDeviceSession(page, token)
  await page.goto('/')
  return token
}

// Raw-HTTP counterpart to generatePassport() below, for the isolation test
// -- no review-prompt popup or card rendering to drive through, just the
// stats snapshot the endpoint returns.
async function generatePassportRaw(
  request: APIRequestContext,
  token: string,
  familyLabel: string,
): Promise<PassportSession> {
  const res = await request.post(`${API}/passport/generate`, {
    ...withSession(token),
    multipart: { family_label: familyLabel },
  })
  expect(res.ok()).toBe(true)
  return res.json()
}

async function getCoinsTotal(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withSession(token))
  const body = (await res.json()) as { total: number }
  return body.total
}

async function generatePassport(page: Page, familyLabel: string, photoPath?: string): Promise<PassportSession> {
  await openNavMenu(page)
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

  // A review-prompt popup appears first on every successful generation --
  // dismiss it (its own flow is covered separately below) to reach the card.
  await dialog.getByRole('button', { name: 'Maybe later' }).click()

  await expect(dialog.locator('.passport-card-title')).toHaveText(session.stats.title)
  return session
}

test.describe('Family Passport', () => {
  test('generates without a photo -- the card renders with no photo element', async ({ page }) => {
    await openApp(page)
    const session = await generatePassport(page, `No Photo Family ${Date.now()}`)

    expect(session.photo_url).toBeNull()
    const dialog = passportDialog(page)
    await expect(dialog.locator('.passport-card-photo')).toHaveCount(0)
    await expect(dialog.getByText(session.family_label)).toBeVisible()

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('generates with a group photo -- the card displays it', async ({ page }) => {
    await openApp(page)
    const session = await generatePassport(page, `Photo Family ${Date.now()}`, FIXTURE_PHOTO)

    expect(session.photo_url).not.toBeNull()
    const dialog = passportDialog(page)
    await expect(dialog.locator('.passport-card-photo')).toHaveAttribute('src', session.photo_url!)
  })

  test('stats reflect real completions across bingo, puzzles, and scoring sheet, and the title follows the strongest category', async ({
    page,
  }) => {
    await openApp(page)

    // Baseline: whatever's already true of the shared demo data before this
    // test's own actions below (0 in a standalone run, or a little
    // cobb-coins.spec.ts residue in a full suite run -- either way, the
    // assertions after only check that these specific numbers went UP).
    const baseline = await generatePassport(page, 'Stats Baseline Check')
    await passportDialog(page).getByRole('button', { name: 'Close' }).click()

    // Bingo: complete any one open tile (+2 coins, same "first open tile"
    // approach as cobb-coins.spec.ts -- the exact tile doesn't matter here).
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Bingo Card' }).click()
    await page.locator('.bingo-tile-open').first().click()
    await page.getByRole('button', { name: 'Completed Challenge' }).click()
    // Completing a tile draws a minigame asynchronously. The overlay has no
    // close button of its own (removed for UI standardization) and Escape is
    // flaky here -- the Godot iframe grabs keyboard focus once it loads, so
    // an Escape keypress from here can land on the iframe's own document
    // instead of bubbling to the parent page's listener, leaving the overlay
    // stuck open and blocking every click underneath it for the rest of the
    // test. Fire the same postMessage the game sends on completion instead.
    const iframeHandle = await page.locator('.minigame-overlay-frame').elementHandle()
    const frame = await iframeHandle?.contentFrame()
    await frame?.evaluate(() => window.parent.postMessage({ type: 'minigame-complete' }, '*'))
    await expect(page.locator('.minigame-overlay')).toHaveCount(0)

    // Puzzle Timer: "Right Turn Only" -- untouched by puzzle-timer.spec.ts
    // (which only exercises Math Maze / Big Mystery Maze), so no risk of
    // double-counting an already-completed attempt from that file.
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Puzzles' }).click()
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
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Scoring Sheets' }).click()
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

    // A win now plays a dramatic MilestoneBanner moment before the result
    // screen (same as scoring-sheet.spec.ts's dismissWinAnimation) -- it
    // auto-dismisses after ~2.8s on its own, but explicitly clicking it
    // through avoids racing that timer against the assertion's timeout
    // under a loaded test run.
    const banner = scoringDialog.locator('.milestone-banner-blackout')
    await expect(banner).toContainText('Guest wins!')
    await banner.click()
    await expect(banner).toHaveCount(0)

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

  test.describe('review-prompt popup', () => {
    test('appears immediately after generation, before the passport card', async ({ page }) => {
      await openApp(page)
      await openNavMenu(page)
      await page.getByRole('button', { name: 'Generate Passport' }).click()
      const dialog = passportDialog(page)
      await dialog.locator('.passport-family-label-input').fill(`Review Prompt Family ${Date.now()}`)

      await Promise.all([
        page.waitForResponse(
          (res: Response) => res.url().includes('/passport/generate') && res.request().method() === 'POST',
        ),
        dialog.getByRole('button', { name: 'Generate Passport' }).click(),
      ])

      await expect(dialog.getByRole('heading', { name: 'Leave a Review, Get a Treat!' })).toBeVisible()
      await expect(dialog.locator('.passport-card-title')).toHaveCount(0)
    })

    test('CTA opens the Google review link in a genuine new tab, and the popup survives to be dismissed after', async ({
      page,
      context,
    }) => {
      await openApp(page)
      await openNavMenu(page)
      await page.getByRole('button', { name: 'Generate Passport' }).click()
      const dialog = passportDialog(page)
      await dialog.locator('.passport-family-label-input').fill(`Review CTA Family ${Date.now()}`)

      const [response] = await Promise.all([
        page.waitForResponse(
          (res: Response) => res.url().includes('/passport/generate') && res.request().method() === 'POST',
        ),
        dialog.getByRole('button', { name: 'Generate Passport' }).click(),
      ])
      const session = (await response.json()) as PassportSession

      const reviewLink = dialog.getByRole('link', { name: /Leave a Google Review/ })
      await expect(reviewLink).toBeVisible()
      await expect(reviewLink).toHaveAttribute('target', '_blank')
      await expect(reviewLink).toHaveAttribute('rel', /noopener/)
      await expect(reviewLink).toHaveAttribute('href', /^https:\/\/www\.google\.com\/search\?/)

      const [newPage] = await Promise.all([context.waitForEvent('page'), reviewLink.click()])
      await newPage.waitForLoadState('domcontentloaded')
      expect(newPage.url()).toContain('google.com')
      await newPage.close()

      // Clicking the CTA didn't dismiss the popup or navigate the original tab away.
      await expect(dialog.getByRole('heading', { name: 'Leave a Review, Get a Treat!' })).toBeVisible()
      expect(page.url()).not.toContain('google.com')

      // Dismissing afterward -- without ever leaving a review -- still reveals
      // the completed passport, not a dead end.
      await dialog.getByRole('button', { name: 'Maybe later' }).click()
      await expect(dialog.locator('.passport-card-title')).toHaveText(session.stats.title)
    })

    test('generating a second passport in the same session shows the prompt again, not just once', async ({ page }) => {
      await openApp(page)
      await generatePassport(page, `Repeat Family One ${Date.now()}`)
      await passportDialog(page).getByRole('button', { name: 'Close' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await openNavMenu(page)
      await page.getByRole('button', { name: 'Generate Passport' }).click()
      const dialog = passportDialog(page)
      await dialog.locator('.passport-family-label-input').fill(`Repeat Family Two ${Date.now()}`)
      await Promise.all([
        page.waitForResponse(
          (res: Response) => res.url().includes('/passport/generate') && res.request().method() === 'POST',
        ),
        dialog.getByRole('button', { name: 'Generate Passport' }).click(),
      ])

      await expect(dialog.getByRole('heading', { name: 'Leave a Review, Get a Treat!' })).toBeVisible()
    })
  })

  test('two device sessions generating a passport see completely independent per-session stats (Coins, Puzzle Timer, Bingo, and now Scavenger Hunt)', async ({
    request,
  }) => {
    // Passport's stats snapshot (app/services/passport.py's _compute_stats)
    // is now fully per-session: Coins, Puzzle Timer (Phases 1/2), Bingo
    // (Phase 6a), and Scavenger Hunt (Phase 6b, migration 030 -- the final
    // phase) all read scoped to device_session_id. This covers all four at
    // once, raw HTTP throughout -- no need to drive the UI end to end, same
    // reasoning as map-visited-sessions.spec.ts's own isolation tests.
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()

    // Session B generates a baseline passport untouched -- session A's
    // actions below must not move any of B's numbers.
    const baselineB = await generatePassportRaw(request, tokenB, `Isolation Baseline B ${Date.now()}`)
    expect(await getCoinsTotal(request, tokenB)).toBe(0)
    expect(baselineB.stats.scavenger_hunt_characters_completed).toBe(0)

    // Session A records a Puzzle Timer attempt (Phase 2, per-session) --
    // this earns A coins and bumps A's own puzzle_challenges_completed,
    // neither of which session B did anything to cause.
    const puzzlesRes = await request.get(`${API}/puzzles`)
    const puzzles = (await puzzlesRes.json()) as { challenges: { id: string }[] }[]
    const challengeId = puzzles[0].challenges[0].id
    const attemptRes = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
      ...withSession(tokenA),
      data: { elapsed_seconds: 10, hints_used: 0 },
    })
    expect(attemptRes.ok()).toBe(true)

    // Session A also completes one Bingo tile (Phase 6a, per-session) --
    // bumps A's own bingo_tiles_completed only, session B's shared-layout
    // view of the same card is untouched.
    const cardsRes = await request.get(`${API}/bingo/cards`)
    const cardId = ((await cardsRes.json()) as { id: string }[])[0].id
    const cardRes = await request.get(`${API}/bingo/card/${cardId}`, withSession(tokenA))
    const tileId = ((await cardRes.json()) as { tiles: { id: string }[] }).tiles[0].id
    const tileRes = await request.post(`${API}/bingo/tiles/${tileId}/complete`, withSession(tokenA))
    expect(tileRes.ok()).toBe(true)

    // Session A also fully completes one Scavenger Hunt character (Phase
    // 6b, per-session) -- bumps A's own scavenger_hunt_characters_completed
    // only. Session B never touches Hunt at all, so its shared-roster view
    // of the same character stays uncompleted.
    const charactersRes = await request.get(`${API}/hunt/characters`, withSession(tokenA))
    const character = (
      (await charactersRes.json()) as { id: string; challenges: { id: string; order_index: number }[] }[]
    )[0]
    for (const challenge of character.challenges.slice().sort((a, b) => a.order_index - b.order_index)) {
      const res = await request.post(`${API}/hunt/challenges/${challenge.id}/complete`, withSession(tokenA))
      expect(res.ok()).toBe(true)
    }

    const passportA = await generatePassportRaw(request, tokenA, `Isolation Session A ${Date.now()}`)
    const passportB = await generatePassportRaw(request, tokenB, `Isolation Session B ${Date.now()}`)

    // Per-session stats: A's own puzzle attempt/coins/bingo tile/hunt
    // character show up only on A's passport, never on B's -- B's numbers
    // are unchanged from its baseline.
    expect(passportA.stats.puzzle_challenges_completed).toBeGreaterThan(baselineB.stats.puzzle_challenges_completed)
    expect(passportA.stats.bingo_tiles_completed).toBeGreaterThan(baselineB.stats.bingo_tiles_completed)
    expect(passportA.stats.scavenger_hunt_characters_completed).toBeGreaterThan(
      baselineB.stats.scavenger_hunt_characters_completed,
    )
    expect(passportA.stats.total_cobb_coins).toBeGreaterThan(0)
    expect(await getCoinsTotal(request, tokenB)).toBe(0)
    expect(passportB.stats.puzzle_challenges_completed).toBe(baselineB.stats.puzzle_challenges_completed)
    expect(passportB.stats.bingo_tiles_completed).toBe(baselineB.stats.bingo_tiles_completed)
    expect(passportB.stats.scavenger_hunt_characters_completed).toBe(
      baselineB.stats.scavenger_hunt_characters_completed,
    )
    expect(passportB.stats.total_cobb_coins).toBe(0)
  })

  test('generating a second passport under the same device session still works after Reset Session', async ({
    request,
  }) => {
    // Reset Session (session_reset.py) does NOT rotate the device token --
    // getDeviceSessionId() (frontend/src/deviceSession.ts) mints it once and
    // never removes it from localStorage, and POST /session/reset resolves
    // the same device_sessions.id via get_or_create_session, only clearing
    // *other* tables' rows under it. So passport_sessions.session_id being
    // deliberately left out of Reset Session's deletes (migration 027)
    // means the same session_id can end up owning more than one passport
    // row over a visit: this confirms that's actually fine -- there's no
    // unique constraint on session_id (multiple passports per session
    // already works today without Reset Session in between, per the
    // "generating a second passport ... shows the prompt again" test above)
    // -- and specifically exercises it with a Reset Session in between.
    const token = crypto.randomUUID()

    const before = await generatePassportRaw(request, token, `Reset Regression Before ${Date.now()}`)

    const resetRes = await request.post(`${API}/session/reset`, withSession(token))
    expect(resetRes.ok()).toBe(true)

    const after = await generatePassportRaw(request, token, `Reset Regression After ${Date.now()}`)
    expect(after.id).not.toBe(before.id)
  })
})
