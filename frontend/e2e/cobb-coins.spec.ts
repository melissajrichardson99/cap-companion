import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { postMinigameResult } from './minigameHelper'

// Covers Cobb Coins' earn side (migration 021_cobb_coins_earn_side.sql):
// Puzzle Timer (unchanged), Bingo milestone tiers (10/25/50, replacing the
// old flat 2-coins-per-tile award -- a bare tile completion with no
// milestone now earns 0), the Scavenger Hunt's per-character award (15) plus
// its one-time +25 hunt-complete bonus, the one-time 50-coin Map Exploration
// bonus (closed nodes excluded, no re-trigger), minigames awarding nothing,
// the coin-earned toast/banner text, and Reset Session clearing the whole
// ledger (including the new one-time-bonus "already awarded" guards, which
// are derived from ledger existence rather than a separate flag).
//
// Per-Device Sessions Phase 1: Coins are now scoped to a device session
// (X-Device-Session header), not a single shared kiosk session. Every test
// below mints its own random token, seeds it into `page`'s localStorage
// before first navigation (seedDeviceSession), and passes it to every raw
// API helper (withSession) so `page`'s own frontend-driven fetches and the
// test's raw HTTP calls stay looking at the same session's ledger. Bingo
// completion is per-session too now (Phase 6a) -- a fresh random token
// naturally starts with every tile open, no reset needed for that half.
// Hunt's own progress table is per-session too now (Phase 6b, the final
// phase) -- a fresh random token naturally starts with every character
// locked/uncompleted, same as Bingo. resetSessionApi is still called between
// tests anyway, to correctly scope the coin-ledger (and Map visited-status,
// Phase 3) halves of what it clears. GET /map/nodes also requires a session
// header now (Phase 3), even where a test only reads the global is_open/
// parent_node_id fields off it -- see getMapNodes below. GET /bingo/card/:id
// and GET /hunt/characters likewise require a session header now (Phases 6a
// and 6b) -- getBingoTileIds/getHuntCharacters below take a token for
// exactly that, even in tests that only care about the shared tile ids/
// challenge content, not this session's own completion status on them. A
// dedicated test at the bottom proves two independent tokens truly get
// independent Coins totals.

const API = 'http://localhost:8000'

async function openNavMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
}

async function expectCoinTotal(page: Page, total: number): Promise<void> {
  await openNavMenu(page)
  await expect(page.locator('.nav-menu-coins')).toHaveText(`🪙 ${total} Cobb Coins`)
}

async function resetSessionApi(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.post(`${API}/session/reset`, withSession(token))
  expect(res.ok()).toBe(true)
}

async function getBingoCardId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/bingo/cards`)
  const cards = (await res.json()) as { id: string }[]
  return cards[0].id
}

async function getBingoTileIds(request: APIRequestContext, cardId: string, token: string): Promise<string[]> {
  const res = await request.get(`${API}/bingo/card/${cardId}`, withSession(token))
  const card = (await res.json()) as { tiles: { id: string }[] }
  return card.tiles.map((t) => t.id)
}

async function apiCompleteTile(request: APIRequestContext, tileId: string, token: string): Promise<any> {
  const res = await request.post(`${API}/bingo/tiles/${tileId}/complete`, withSession(token))
  return res.json()
}

// Per-Device Sessions Phase 6b: GET /hunt/characters now requires a device
// session header too, like every other Hunt endpoint -- the token here scopes
// the returned found/completed status, though this call site only cares
// about the shared (global) challenges list per character.
async function getHuntCharacters(request: APIRequestContext, token: string): Promise<any[]> {
  const res = await request.get(`${API}/hunt/characters`, withSession(token))
  return res.json()
}

async function apiCompleteCharacter(request: APIRequestContext, character: any, token: string): Promise<any> {
  let last: any
  for (const challenge of character.challenges) {
    const res = await request.post(`${API}/hunt/challenges/${challenge.id}/complete`, withSession(token))
    last = await res.json()
  }
  return last
}

async function getCoinsTotal(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withSession(token))
  const body = (await res.json()) as { total: number }
  return body.total
}

interface MapNodeRow {
  id: string
  name: string
  is_open: boolean
  parent_node_id: string | null
}

// Per-Device Sessions Phase 3: GET /map/nodes now requires a device session
// header like every other map endpoint. The token passed here only ever
// needs to resolve *a* session -- these call sites only read is_open/
// parent_node_id/name, which stay global, not this-session visited status.
async function getMapNodes(request: APIRequestContext, token: string): Promise<MapNodeRow[]> {
  const res = await request.get(`${API}/map/nodes`, withSession(token))
  return res.json()
}

async function setNodeOpen(request: APIRequestContext, token: string, nodeId: string, isOpen: boolean): Promise<void> {
  const res = await request.patch(`${API}/map/nodes/${nodeId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { is_open: isOpen },
  })
  expect(res.ok()).toBe(true)
}

async function visitNode(
  request: APIRequestContext,
  token: string,
  nodeId: string,
  completedTileIds: string[] = [],
): Promise<any> {
  const res = await request.post(`${API}/map/nodes/${nodeId}/visit`, {
    ...withSession(token),
    data: { completed_tile_ids: completedTileIds },
  })
  return res.json()
}

async function dismissMinigameOverlay(page: Page): Promise<void> {
  const iframeHandle = await page.locator('.minigame-overlay-frame').elementHandle()
  const frame = await iframeHandle?.contentFrame()
  await frame?.evaluate(() => window.parent.postMessage({ type: 'minigame-complete' }, '*'))
  await expect(page.locator('.minigame-overlay')).toHaveCount(0)
}

// Clicks the first still-open tile and confirms it. Since DOM position never
// changes (only the open/completed class does -- BingoScreen sorts tiles by
// row*5+col once, up front), the first-open tile always advances through
// grid indices 0, 1, 2, ... in order as each prior one completes and drops
// out of `.bingo-tile-open`.
//
// That drop-out only happens once App's post-completion card reload lands,
// which races the minigame overlay: dismissing the overlay quickly can beat
// the reload, leaving the just-completed tile still `.bingo-tile-open` --
// the next call would then re-open that same tile, the backend correctly
// treats it as already complete (no minigame drawn), and no overlay ever
// appears. So wait for the open count to actually drop before returning.
async function completeFirstOpenTile(page: Page): Promise<void> {
  const openTiles = page.locator('.bingo-tile-open')
  // count() doesn't auto-wait -- make sure the card has rendered first.
  await expect(openTiles.first()).toBeVisible()
  const openBefore = await openTiles.count()
  await openTiles.first().click()
  await page.getByRole('button', { name: 'Completed Challenge' }).click()
  await dismissMinigameOverlay(page)
  await expect(openTiles).toHaveCount(openBefore - 1)
}

const PIG_UNLOCK_CODE = 'happy-panda'

test.describe('Cobb Coins', () => {
  // Belt-and-suspenders cleanup for the Map Exploration tests below, same
  // pattern as attraction-status.spec.ts's own afterEach -- reopens any
  // top-level node this file's tests left closed, regardless of which test
  // closed it or whether it failed partway through. map_nodes.is_open stays
  // global/staff-only this phase, so no device token is involved here.
  test.afterEach(async ({ request }) => {
    const token = await apiStaffLogin(request)
    const rows = await getMapNodes(request, crypto.randomUUID())
    const closedTopLevel = rows.filter((r) => r.parent_node_id === null && !r.is_open)
    await Promise.all(closedTopLevel.map((r) => setNodeOpen(request, token, r.id, true)))
  })

  test('Puzzle Timer (+12) and a real Bingo line (+10 only on the 5th tile) -- the milestone banner shows the coin amount', async ({
    page,
    request,
  }) => {
    // Puzzle Timer + 5 Bingo tile completions through the real UI -- each
    // tile completion is now several sequential round trips against the
    // real dev Supabase project (session_tile_completions read/write, Per-
    // Device Sessions Phase 6a), so this needs more than the default 30s
    // per-test budget.
    test.setTimeout(90_000)
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    await page.goto('/')
    await expectCoinTotal(page, 0)

    // Puzzle Timer: Math Maze "Standard", 0 hints used -> 12 coins, unchanged
    // by this feature.
    await page.getByRole('menuitemradio', { name: 'Puzzles' }).click()
    const mathMazeCard = page.locator('.puzzle-card', { hasText: 'Math Maze' })
    await mathMazeCard.getByRole('button', { name: 'Standard' }).click()
    const puzzleDialog = page.getByRole('dialog')
    await puzzleDialog.getByRole('button', { name: 'Start', exact: true }).click()
    await page.waitForTimeout(1200)
    await puzzleDialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await puzzleDialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(puzzleDialog.getByText('Hints used: 0/3')).toBeVisible()
    await expectCoinTotal(page, 12)
    await page.keyboard.press('Escape') // close the nav menu
    await page.keyboard.press('Escape') // close the puzzle result dialog

    // Bingo: complete a full line (5 tiles = grid indices 0-4, i.e. row 0).
    // The flat per-tile award is gone -- tiles 1-4 alone earn nothing, only
    // the 5th (which closes the line) pays out, and it pays the milestone
    // tier, not a per-tile amount.
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Bingo Card' }).click()
    for (let i = 0; i < 4; i++) {
      await completeFirstOpenTile(page)
    }
    await page.locator('.bingo-tile-open').first().click()
    await page.getByRole('button', { name: 'Completed Challenge' }).click()
    await dismissMinigameOverlay(page)

    const banner = page.locator('.milestone-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('BINGO')
    // Folded into the banner (not a separate toast) -- a bingo coin award
    // only ever happens alongside a milestone now, so a competing toast
    // here would just duplicate what the banner already says.
    await expect(banner.locator('.milestone-banner-coins')).toHaveText('🪙 +10 Cobb Coins')
    await banner.click() // dismiss

    await expectCoinTotal(page, 22)
  })

  test('a completion that closes the X shape without closing any row/col along the way pays the X/double-bingo tier (25) cleanly', async ({
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId, token)
    const X_SHAPE = [0, 4, 6, 8, 12, 16, 18, 20, 24]

    let last: any
    for (const i of X_SHAPE) {
      last = await apiCompleteTile(request, tileIds[i], token)
    }
    expect(last.milestones).toHaveLength(1)
    expect(last.milestones[0].type).toBe('x')
    expect(last.coins_awarded).toBe(25)

    expect(await getCoinsTotal(request, token)).toBe(25)
  })

  test('filling the whole card pays each new line (10) as it closes; the final tile, which closes a line + the X shape + blackout at once, pays only blackout (50) -- not the sum of every simultaneous tier', async ({
    request,
  }) => {
    // 25 sequential tile completions against the real dev Supabase project
    // -- same "more than the default 30s budget" reasoning as the test
    // above, just via raw HTTP instead of the UI.
    test.setTimeout(60_000)
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId, token)

    let runningTotal = 0
    let last: any
    for (let i = 0; i < 25; i++) {
      last = await apiCompleteTile(request, tileIds[i], token)
      runningTotal += last.coins_awarded
    }

    // Tile 24 simultaneously closes row 4, col 4, the X shape, and
    // blackout -- the displayed/awarded tier must be blackout alone.
    expect(last.milestones).toHaveLength(1)
    expect(last.milestones[0].type).toBe('blackout')
    expect(last.coins_awarded).toBe(50)
    // Rows 0-3 + cols 0-3 (8 lines) x 10, plus blackout's 50 = 130.
    expect(runningTotal).toBe(130)

    expect(await getCoinsTotal(request, token)).toBe(130)
  })

  test('Scavenger Hunt: 15 coins per character found, +25 once for the 5th/last character, and the coin toast appears', async ({
    page,
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    const characters = await getHuntCharacters(request, token)
    const others = characters.filter((c) => c.name !== 'Pig')
    expect(others).toHaveLength(4)

    for (const character of others) {
      const result = await apiCompleteCharacter(request, character, token)
      expect(result.coins_awarded).toBe(15)
    }
    expect(await getCoinsTotal(request, token)).toBe(60)

    // Pig, the 5th and last character, completed via the real UI so the
    // "+40 Cobb Coins" (15 + the one-time 25 bonus) toast is exercised end
    // to end, not just asserted from the raw API response. A fresh scan
    // lands on the "character found" popup first -- race its "Start
    // Challenges" button against the challenge heading directly (same
    // pattern as scavenger-hunt.spec.ts's unlockCharacter helper), since a
    // synchronous isVisible() check right after goto can run before either
    // has rendered and silently skip the button.
    await page.goto(`/scan/${PIG_UNLOCK_CODE}`)
    const dialog = page.locator('.modal-panel')
    const startButton = page.getByRole('button', { name: 'Start Challenges' })
    const challengeHeading = dialog.getByText('Pig — Challenge 1')
    await Promise.race([
      startButton.waitFor({ state: 'visible' }).catch(() => {}),
      challengeHeading.waitFor({ state: 'visible' }).catch(() => {}),
    ])
    if (await startButton.isVisible()) {
      await startButton.click()
    }
    await expect(challengeHeading).toBeVisible()
    await dialog.getByRole('button', { name: 'Rolling in mud', exact: true }).click()
    await expect(dialog.getByText('Pig — Challenge 2')).toBeVisible()
    await dialog.getByRole('button', { name: 'Dolphins and primates', exact: true }).click()
    await expect(dialog.getByText('Pig — Challenge 3')).toBeVisible()
    await dialog.getByRole('button', { name: 'Play Now' }).click()
    // Challenge 3 completes only once a round has ended (MinigameOverlay).
    await postMinigameResult(page, { outcome: 'win', stats: {} })
    await dismissMinigameOverlay(page)

    await expect(page.locator('.toast', { hasText: '+40 Cobb Coins' })).toBeVisible()
    await expect(dialog.getByText('You found Pig! All 3 challenges complete.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()

    await expectCoinTotal(page, 100)
  })

  test('Map Exploration: 50 coins once every open top-level node is visited; a closed node does not block it; visiting again does not re-award', async ({
    page,
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    const staffToken = await apiStaffLogin(request)
    const rows = await getMapNodes(request, token)
    const topLevel = rows.filter((r) => r.parent_node_id === null)
    // Ticket Booth has zero linked bingo tiles, so "Mark Visited" completes
    // in a single click with no tile-confirmation popups in the way (same
    // reasoning attraction-status.spec.ts documents).
    const ticketBooth = topLevel.find((r) => r.name === 'Ticket Booth')!
    const others = topLevel.filter((r) => r.id !== ticketBooth.id)
    await Promise.all(others.map((r) => setNodeOpen(request, staffToken, r.id, false)))

    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Map' }).click()
    await page.locator('.map-pin[aria-label^="Ticket Booth"]').click()
    const dialog = page.getByRole('dialog', { name: 'Ticket Booth' })
    await dialog.getByRole('button', { name: 'Mark Visited' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(page.locator('.toast', { hasText: '+50 Cobb Coins' })).toBeVisible()
    await expectCoinTotal(page, 50)

    // Re-visiting (the completeness condition still holds) must not
    // re-award -- the existence-check guard in _check_map_exploration_bonus
    // blocks it.
    const json = await visitNode(request, token, ticketBooth.id)
    expect(json.coins_awarded).toBe(0)

    expect(await getCoinsTotal(request, token)).toBe(50)
  })

  test('minigames never award coins -- a bare tile completion (no milestone) earns 0 regardless of the minigame it draws', async ({
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId, token)

    const json = await apiCompleteTile(request, tileIds[10], token)
    expect(json.milestones).toHaveLength(0)
    expect(json.coins_awarded).toBe(0)
    expect(json.minigames_drawn.length).toBeGreaterThan(0) // a minigame is still drawn...

    expect(await getCoinsTotal(request, token)).toBe(0) // ...but it never awards anything.
  })

  test('Reset Session zeroes the coin ledger and clears one-time-bonus eligibility, not just the visible total', async ({
    page,
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId, token)
    for (let i = 0; i < 5; i++) {
      await apiCompleteTile(request, tileIds[i], token)
    }
    expect(await getCoinsTotal(request, token)).toBe(10)

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
    await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
    await expect(resetConfirmDialog).toHaveCount(0)
    await expectCoinTotal(page, 0)

    expect(await getCoinsTotal(request, token)).toBe(0)

    // Re-earn the Map Exploration bonus from scratch -- this proves the
    // ledger wipe actually cleared this session's "already awarded" guard
    // (there's no separate tracking flag; existence in coin_awards IS the
    // guard, scoped to session_id per Per-Device Sessions Phase 1), not
    // just that the visible total happened to read 0.
    const staffToken = await apiStaffLogin(request)
    const rows = await getMapNodes(request, token)
    const topLevel = rows.filter((r) => r.parent_node_id === null)
    const ticketBooth = topLevel.find((r) => r.name === 'Ticket Booth')!
    const others = topLevel.filter((r) => r.id !== ticketBooth.id)
    await Promise.all(others.map((r) => setNodeOpen(request, staffToken, r.id, false)))

    const json = await visitNode(request, token, ticketBooth.id)
    expect(json.coins_awarded).toBe(50)
  })

  test('two independent device sessions (two browser contexts) have completely independent Coins balances', async ({
    browser,
    request,
  }) => {
    // Two real, separate browser contexts -- each mints its own random
    // device-session token the normal way (deviceSession.ts's
    // getDeviceSessionId(), on first localStorage read), simulating two
    // different guests' own phones rather than one shared kiosk session.
    // No manual token seeding needed here, unlike the single-session tests
    // above -- that's the point of using two contexts for this one.
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    let tokenA: string | null = null
    let tokenB: string | null = null

    try {
      await pageA.goto('/')
      await pageB.goto('/')

      tokenA = await pageA.evaluate(() => localStorage.getItem('cap-device-session-id'))
      tokenB = await pageB.evaluate(() => localStorage.getItem('cap-device-session-id'))
      expect(tokenA).toBeTruthy()
      expect(tokenB).toBeTruthy()
      expect(tokenA).not.toBe(tokenB)

      await resetSessionApi(request, tokenA!)
      await resetSessionApi(request, tokenB!)

      // Session A completes a whole bingo line (+10) via raw HTTP under its
      // own token; session B never touches the ledger at all.
      const cardId = await getBingoCardId(request)
      const tileIds = await getBingoTileIds(request, cardId, tokenA!)
      for (let i = 0; i < 5; i++) {
        await apiCompleteTile(request, tileIds[i], tokenA!)
      }

      expect(await getCoinsTotal(request, tokenA!)).toBe(10)
      expect(await getCoinsTotal(request, tokenB!)).toBe(0)

      // The raw completions above bypassed pageA's own UI entirely, so its
      // already-mounted React state still reflects whatever it fetched on
      // its initial goto -- a reload is needed to see the raw calls' effect
      // reflected in the nav-menu pill (same reasoning as any other
      // out-of-band DB mutation the frontend doesn't poll for on its own).
      await pageA.reload()
      await pageB.reload()
      await expectCoinTotal(pageA, 10)
      await expectCoinTotal(pageB, 0)

      // Resetting A must not touch B's (already-zero) balance -- asserted
      // by re-checking B is still exactly 0, not just "still not 10".
      await resetSessionApi(request, tokenA!)
      expect(await getCoinsTotal(request, tokenA!)).toBe(0)
      expect(await getCoinsTotal(request, tokenB!)).toBe(0)
    } finally {
      // Guaranteed cleanup regardless of where an assertion above fails --
      // Bingo completion is per-session (Phase 6a) so tokenA's tiles can't
      // leak into another spec file's own random token, but the coin ledger
      // this test earned into is still worth tidying up on the same
      // belt-and-suspenders principle.
      if (tokenA) await resetSessionApi(request, tokenA).catch(() => {})
      if (tokenB) await resetSessionApi(request, tokenB).catch(() => {})
      await contextA.close()
      await contextB.close()
    }
  })
})
