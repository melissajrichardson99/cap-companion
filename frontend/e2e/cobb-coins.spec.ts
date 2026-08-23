import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin } from './staffAuthHelper'

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
// Every test resets the shared kiosk session itself via a raw POST to
// /session/reset before driving anything, so -- unlike the old version of
// this file -- there's no dependency on running first alphabetically or on
// any other spec's incidental state. Bulk/precise tier math is exercised via
// raw HTTP against the same endpoints the UI calls (bingo_tiles are always
// returned row_index/col_index-ordered, i.e. row-major, so tiles[i] is grid
// index i); a couple of scenarios also drive the real UI end to end
// specifically to prove the banner/toast actually render.

const API = 'http://localhost:8000'

async function openNavMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
}

async function expectCoinTotal(page: Page, total: number): Promise<void> {
  await openNavMenu(page)
  await expect(page.locator('.nav-menu-coins')).toHaveText(`🪙 ${total} Cobb Coins`)
}

async function resetSessionApi(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API}/session/reset`)
  expect(res.ok()).toBe(true)
}

async function getBingoCardId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/bingo/cards`)
  const cards = (await res.json()) as { id: string }[]
  return cards[0].id
}

async function getBingoTileIds(request: APIRequestContext, cardId: string): Promise<string[]> {
  const res = await request.get(`${API}/bingo/card/${cardId}`)
  const card = (await res.json()) as { tiles: { id: string }[] }
  return card.tiles.map((t) => t.id)
}

async function apiCompleteTile(request: APIRequestContext, tileId: string): Promise<any> {
  const res = await request.post(`${API}/bingo/tiles/${tileId}/complete`)
  return res.json()
}

async function getHuntCharacters(request: APIRequestContext): Promise<any[]> {
  const res = await request.get(`${API}/hunt/characters`)
  return res.json()
}

async function apiCompleteCharacter(request: APIRequestContext, character: any): Promise<any> {
  let last: any
  for (const challenge of character.challenges) {
    const res = await request.post(`${API}/hunt/challenges/${challenge.id}/complete`)
    last = await res.json()
  }
  return last
}

interface MapNodeRow {
  id: string
  name: string
  is_open: boolean
  parent_node_id: string | null
}

async function getMapNodes(request: APIRequestContext): Promise<MapNodeRow[]> {
  const res = await request.get(`${API}/map/nodes`)
  return res.json()
}

async function setNodeOpen(request: APIRequestContext, token: string, nodeId: string, isOpen: boolean): Promise<void> {
  const res = await request.patch(`${API}/map/nodes/${nodeId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { is_open: isOpen },
  })
  expect(res.ok()).toBe(true)
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
async function completeFirstOpenTile(page: Page): Promise<void> {
  await page.locator('.bingo-tile-open').first().click()
  await page.getByRole('button', { name: 'Completed Challenge' }).click()
  await dismissMinigameOverlay(page)
}

const PIG_UNLOCK_CODE = 'happy-panda'

test.describe('Cobb Coins', () => {
  // Belt-and-suspenders cleanup for the Map Exploration tests below, same
  // pattern as attraction-status.spec.ts's own afterEach -- reopens any
  // top-level node this file's tests left closed, regardless of which test
  // closed it or whether it failed partway through.
  test.afterEach(async ({ request }) => {
    const token = await apiStaffLogin(request)
    const rows = await getMapNodes(request)
    const closedTopLevel = rows.filter((r) => r.parent_node_id === null && !r.is_open)
    await Promise.all(closedTopLevel.map((r) => setNodeOpen(request, token, r.id, true)))
  })

  test('Puzzle Timer (+12) and a real Bingo line (+10 only on the 5th tile) -- the milestone banner shows the coin amount', async ({
    page,
    request,
  }) => {
    await resetSessionApi(request)
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
    await resetSessionApi(request)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId)
    const X_SHAPE = [0, 4, 6, 8, 12, 16, 18, 20, 24]

    let last: any
    for (const i of X_SHAPE) {
      last = await apiCompleteTile(request, tileIds[i])
    }
    expect(last.milestones).toHaveLength(1)
    expect(last.milestones[0].type).toBe('x')
    expect(last.coins_awarded).toBe(25)

    const summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(25)
  })

  test('filling the whole card pays each new line (10) as it closes; the final tile, which closes a line + the X shape + blackout at once, pays only blackout (50) -- not the sum of every simultaneous tier', async ({
    request,
  }) => {
    await resetSessionApi(request)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId)

    let runningTotal = 0
    let last: any
    for (let i = 0; i < 25; i++) {
      last = await apiCompleteTile(request, tileIds[i])
      runningTotal += last.coins_awarded
    }

    // Tile 24 simultaneously closes row 4, col 4, the X shape, and
    // blackout -- the displayed/awarded tier must be blackout alone.
    expect(last.milestones).toHaveLength(1)
    expect(last.milestones[0].type).toBe('blackout')
    expect(last.coins_awarded).toBe(50)
    // Rows 0-3 + cols 0-3 (8 lines) x 10, plus blackout's 50 = 130.
    expect(runningTotal).toBe(130)

    const summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(130)
  })

  test('Scavenger Hunt: 15 coins per character found, +25 once for the 5th/last character, and the coin toast appears', async ({
    page,
    request,
  }) => {
    await resetSessionApi(request)
    const characters = await getHuntCharacters(request)
    const others = characters.filter((c) => c.name !== 'Pig')
    expect(others).toHaveLength(4)

    for (const character of others) {
      const result = await apiCompleteCharacter(request, character)
      expect(result.coins_awarded).toBe(15)
    }
    let summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(60)

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
    await resetSessionApi(request)
    const token = await apiStaffLogin(request)
    const rows = await getMapNodes(request)
    const topLevel = rows.filter((r) => r.parent_node_id === null)
    // Ticket Booth has zero linked bingo tiles, so "Mark Visited" completes
    // in a single click with no tile-confirmation popups in the way (same
    // reasoning attraction-status.spec.ts documents).
    const ticketBooth = topLevel.find((r) => r.name === 'Ticket Booth')!
    const others = topLevel.filter((r) => r.id !== ticketBooth.id)
    await Promise.all(others.map((r) => setNodeOpen(request, token, r.id, false)))

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
    const res = await request.post(`${API}/map/nodes/${ticketBooth.id}/visit`, { data: { completed_tile_ids: [] } })
    const json = await res.json()
    expect(json.coins_awarded).toBe(0)

    const summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(50)
  })

  test('minigames never award coins -- a bare tile completion (no milestone) earns 0 regardless of the minigame it draws', async ({
    request,
  }) => {
    await resetSessionApi(request)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId)

    const json = await apiCompleteTile(request, tileIds[10])
    expect(json.milestones).toHaveLength(0)
    expect(json.coins_awarded).toBe(0)
    expect(json.minigames_drawn.length).toBeGreaterThan(0) // a minigame is still drawn...

    const summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(0) // ...but it never awards anything.
  })

  test('Reset Session zeroes the coin ledger and clears one-time-bonus eligibility, not just the visible total', async ({
    page,
    request,
  }) => {
    await resetSessionApi(request)
    const cardId = await getBingoCardId(request)
    const tileIds = await getBingoTileIds(request, cardId)
    for (let i = 0; i < 5; i++) {
      await apiCompleteTile(request, tileIds[i])
    }
    let summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(10)

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
    await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
    await expect(resetConfirmDialog).toHaveCount(0)
    await expectCoinTotal(page, 0)

    summary = await (await request.get(`${API}/coins/summary`)).json()
    expect(summary.total).toBe(0)

    // Re-earn the Map Exploration bonus from scratch -- this proves the
    // ledger wipe actually cleared the "already awarded" guard (there's no
    // separate tracking flag; existence in coin_awards IS the guard), not
    // just that the visible total happened to read 0.
    const token = await apiStaffLogin(request)
    const rows = await getMapNodes(request)
    const topLevel = rows.filter((r) => r.parent_node_id === null)
    const ticketBooth = topLevel.find((r) => r.name === 'Ticket Booth')!
    const others = topLevel.filter((r) => r.id !== ticketBooth.id)
    await Promise.all(others.map((r) => setNodeOpen(request, token, r.id, false)))

    const res = await request.post(`${API}/map/nodes/${ticketBooth.id}/visit`, { data: { completed_tile_ids: [] } })
    const json = await res.json()
    expect(json.coins_awarded).toBe(50)
  })
})
