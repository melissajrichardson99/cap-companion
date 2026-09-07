import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiStaffLogin } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'

// Guest Accounts Phase 3 -- Bingo + Map Exploration as a combined lifetime
// account total (migration 037_guest_accounts_bingo_map_reset.sql).
// Complements frontend/e2e/guest-accounts-lifetime.spec.ts (Phase 1's Coins/
// Collectibles equivalent -- same shape of tests, reused here for Bingo/Map)
// and bingo-sessions.spec.ts/map-visited-sessions.spec.ts (anonymous,
// per-device-session behavior -- deliberately untouched by this phase and
// not re-tested here).
//
// Two things get more scrutiny than a typical "just extend the existing
// pattern" phase, because review flagged them as the places this kind of
// change is most likely to hide a real bug:
//
//   1. The cross-session milestone case: a line closed by *combining*
//      partial progress from two of a guest's linked sessions, not just two
//      sessions completing disjoint tiles (see "the cross-session milestone
//      scenario" below).
//   2. Start Fresh's re-earnability must come from the completions actually
//      being deleted, not from some independently-reset flag. Map
//      Exploration's guard is ledger-based (coin_awards, append-only) rather
//      than derived live like Bingo's, so it needed a real fix (guests.
//      bingo_map_reset_at) rather than just a test -- see backend/app/
//      services/map_bingo.py's _check_map_exploration_bonus docstring. The
//      "Start Fresh re-earnability" test below proves this by asserting the
//      guest's coin total is UNCHANGED immediately after Start Fresh (old
//      awards preserved, nothing clawed back) before proving new awards land
//      on re-earning.

const API = 'http://localhost:8000'

const PASSWORD = 'correct horse battery staple'

function uniqueEmail(): string {
  return `guest-bingo-map-${crypto.randomUUID()}@example.com`
}

function withGuestSession(deviceToken: string, guestToken?: string): { headers: Record<string, string> } {
  const headers: Record<string, string> = { 'X-Device-Session': deviceToken }
  if (guestToken) headers['X-Guest-Auth'] = guestToken
  return { headers }
}

async function resetSessionApi(
  request: APIRequestContext,
  deviceToken: string,
  guestToken?: string,
): Promise<{ guest_logged_out: boolean; bingo_tiles_reset: number; map_nodes_reset: number }> {
  const res = await request.post(`${API}/session/reset`, withGuestSession(deviceToken, guestToken))
  expect(res.ok()).toBe(true)
  return res.json()
}

async function signup(request: APIRequestContext, deviceToken: string, email: string): Promise<string> {
  const res = await request.post(`${API}/account/signup`, {
    ...withSession(deviceToken),
    data: { email, password: PASSWORD },
  })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { token: string }
  return body.token
}

async function login(request: APIRequestContext, deviceToken: string, email: string): Promise<string> {
  const res = await request.post(`${API}/account/login`, {
    ...withSession(deviceToken),
    data: { email, password: PASSWORD },
  })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { token: string }
  return body.token
}

interface CardResponse {
  tiles: { id: string; completed: boolean }[]
  milestones_achieved: { lines: number[]; x: boolean; blackout: boolean }
}

async function getCardId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/bingo/cards`)
  const cards = (await res.json()) as { id: string }[]
  return cards[0].id
}

async function getCard(
  request: APIRequestContext,
  cardId: string,
  deviceToken: string,
  guestToken?: string,
): Promise<CardResponse> {
  const res = await request.get(`${API}/bingo/card/${cardId}`, withGuestSession(deviceToken, guestToken))
  return res.json()
}

async function getTileIds(request: APIRequestContext, cardId: string, deviceToken: string): Promise<string[]> {
  const card = await getCard(request, cardId, deviceToken)
  return card.tiles.map((t) => t.id)
}

async function completeTile(
  request: APIRequestContext,
  tileId: string,
  deviceToken: string,
  guestToken?: string,
): Promise<{ milestones: { type: string }[]; coins_awarded: number }> {
  const res = await request.post(`${API}/bingo/tiles/${tileId}/complete`, withGuestSession(deviceToken, guestToken))
  return res.json()
}

interface MapNodeRow {
  id: string
  name: string
  visited: boolean
  is_open: boolean
  parent_node_id: string | null
}

async function getMapNodes(request: APIRequestContext, deviceToken: string, guestToken?: string): Promise<MapNodeRow[]> {
  const res = await request.get(`${API}/map/nodes`, withGuestSession(deviceToken, guestToken))
  return res.json()
}

async function setNodeOpen(request: APIRequestContext, staffToken: string, nodeId: string, isOpen: boolean): Promise<void> {
  const res = await request.patch(`${API}/map/nodes/${nodeId}/status`, {
    headers: { Authorization: `Bearer ${staffToken}` },
    data: { is_open: isOpen },
  })
  expect(res.ok()).toBe(true)
}

async function visitNode(
  request: APIRequestContext,
  deviceToken: string,
  nodeId: string,
  guestToken?: string,
): Promise<{ coins_awarded: number }> {
  const res = await request.post(`${API}/map/nodes/${nodeId}/visit`, {
    ...withGuestSession(deviceToken, guestToken),
    data: { completed_tile_ids: [] },
  })
  return res.json()
}

async function getCoinsTotal(request: APIRequestContext, deviceToken: string, guestToken?: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withGuestSession(deviceToken, guestToken))
  const body = (await res.json()) as { total: number }
  return body.total
}

interface BingoMapStatus {
  has_progress: boolean
  tiles_completed: number
  tiles_total: number
  nodes_visited: number
}

async function getBingoMapStatus(request: APIRequestContext, deviceToken: string, guestToken: string): Promise<BingoMapStatus> {
  const res = await request.get(`${API}/account/bingo-map/status`, withGuestSession(deviceToken, guestToken))
  expect(res.ok()).toBe(true)
  return res.json()
}

async function startFresh(
  request: APIRequestContext,
  deviceToken: string,
  guestToken: string,
): Promise<{ bingo_tiles_reset: number; map_nodes_reset: number }> {
  const res = await request.post(`${API}/account/bingo-map/start-fresh`, withGuestSession(deviceToken, guestToken))
  expect(res.ok()).toBe(true)
  return res.json()
}

// Only these two top-level nodes carry zero linked bingo tiles (confirmed in
// seed.sql, same fact map-visited-sessions.spec.ts relies on) -- visiting
// just them with completed_tile_ids: [] never trips the tile-confirmation
// flow, keeping the Map Exploration tests below fast and side-effect-free.
const EXPLORATION_NODE_NAMES = ['Ticket Booth', 'Restrooms']

async function closeOtherTopLevelNodes(request: APIRequestContext, staffToken: string): Promise<MapNodeRow[]> {
  const rows = await getMapNodes(request, crypto.randomUUID())
  const topLevel = rows.filter((r) => r.parent_node_id === null)
  const exploration = EXPLORATION_NODE_NAMES.map((name) => topLevel.find((r) => r.name === name)!)
  const others = topLevel.filter((r) => !exploration.some((e) => e.id === r.id))
  await Promise.all(others.map((r) => setNodeOpen(request, staffToken, r.id, false)))
  return exploration
}

test.describe('Guest Accounts Phase 3 -- Bingo + Map Exploration carry-forward', () => {
  // Belt-and-suspenders cleanup for the Map Exploration tests, which close
  // every top-level node except the two zero-linked-tile ones -- same
  // pattern as map-visited-sessions.spec.ts's own afterEach.
  test.afterEach(async ({ request }) => {
    const staffToken = await apiStaffLogin(request)
    const rows = await getMapNodes(request, crypto.randomUUID())
    const closedTopLevel = rows.filter((r) => r.parent_node_id === null && !r.is_open)
    await Promise.all(closedTopLevel.map((r) => setNodeOpen(request, staffToken, r.id, true)))
  })

  test('two different logged-in guests never see each other\'s Bingo/Map progress', async ({ request }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)
    const guestTokenA = await signup(request, tokenA, emailA)
    const guestTokenB = await signup(request, tokenB, emailB)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    const rows = await getMapNodes(request, tokenA)
    const ticketBooth = rows.find((r) => r.name === 'Ticket Booth')!

    await completeTile(request, tileIds[0], tokenA, guestTokenA)
    await visitNode(request, tokenB, ticketBooth.id, guestTokenB)

    const cardA = await getCard(request, cardId, tokenA, guestTokenA)
    expect(cardA.tiles[0].completed).toBe(true)
    const cardB = await getCard(request, cardId, tokenB, guestTokenB)
    expect(cardB.tiles[0].completed).toBe(false)

    const nodesA = await getMapNodes(request, tokenA, guestTokenA)
    expect(nodesA.find((n) => n.id === ticketBooth.id)!.visited).toBe(false)
    const nodesB = await getMapNodes(request, tokenB, guestTokenB)
    expect(nodesB.find((n) => n.id === ticketBooth.id)!.visited).toBe(true)
  })

  test('completing a tile pre-login then signing up folds it into the guest-wide read', async ({ request }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    await completeTile(request, tileIds[10], tokenA) // anonymous, before signup

    const guestTokenA = await signup(request, tokenA, email)
    const card = await getCard(request, cardId, tokenA, guestTokenA)
    expect(card.tiles[10].completed).toBe(true)
  })

  test('the cross-session milestone scenario: a line closed by combining two linked sessions pays exactly once, and stays paid exactly once', async ({
    request,
  }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)
    const guestTokenA = await signup(request, tokenA, email)
    const guestTokenB = await login(request, tokenB, email) // links tokenB to the SAME guest

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    // Row 2 (grid indices 10-14): a clean, unambiguous 5-tile line.
    const rowIndices = [10, 11, 12, 13, 14]

    // Session A completes 4 of the 5 -- one short of the line, from this
    // guest's own device A.
    for (const i of rowIndices.slice(0, 4)) {
      const result = await completeTile(request, tileIds[i], tokenA, guestTokenA)
      expect(result.milestones).toHaveLength(0)
    }

    // Session B -- a SECOND device linked to the SAME guest -- completes the
    // 5th tile. The line only becomes complete by combining A's and B's
    // completions; this is the case that specifically exercises the guest-
    // wide `completed_indices` set, not just two sessions doing disjoint work.
    const closingResult = await completeTile(request, tileIds[rowIndices[4]], tokenB, guestTokenB)
    expect(closingResult.milestones).toHaveLength(1)
    expect(closingResult.milestones[0].type).toBe('line')
    expect(closingResult.coins_awarded).toBe(10)
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(10)

    // Further guest activity that leaves the same line still (trivially)
    // complete must not re-pay it -- proves the guard reads "already
    // achieved" off the live guest-wide set, not off which single session
    // did the completing.
    const unrelated = await completeTile(request, tileIds[1], tokenA, guestTokenA)
    expect(unrelated.milestones).toHaveLength(0)
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(10)
  })

  test('Map Exploration bonus pays exactly once across linked sessions and does not re-pay on a later "continue" visit', async ({
    request,
  }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)
    const guestTokenA = await signup(request, tokenA, email)
    const guestTokenB = await login(request, tokenB, email)

    const staffToken = await apiStaffLogin(request)
    const [ticketBooth, restrooms] = await closeOtherTopLevelNodes(request, staffToken)

    // Session A visits one of the two remaining open nodes...
    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)
    // ...session B (same guest, second linked device) visits the other,
    // closing the set only when combined across both sessions.
    const closingVisit = await visitNode(request, tokenB, restrooms.id, guestTokenB)
    expect(closingVisit.coins_awarded).toBe(50)
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(50)

    // A later "continue" visit (re-visiting an already-visited node) must
    // not re-pay the bonus.
    const revisit = await visitNode(request, tokenA, ticketBooth.id, guestTokenA)
    expect(revisit.coins_awarded).toBe(0)
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(50)
  })

  test('GET /account/bingo-map/status reports correct numbers before and after progress exists', async ({ request }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const before = await getBingoMapStatus(request, tokenA, guestTokenA)
    expect(before).toEqual({ has_progress: false, tiles_completed: 0, tiles_total: 25, nodes_visited: 0 })

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    await completeTile(request, tileIds[0], tokenA, guestTokenA)
    await completeTile(request, tileIds[1], tokenA, guestTokenA)

    const staffToken = await apiStaffLogin(request)
    const [ticketBooth] = await closeOtherTopLevelNodes(request, staffToken)
    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)

    const after = await getBingoMapStatus(request, tokenA, guestTokenA)
    expect(after).toEqual({ has_progress: true, tiles_completed: 2, tiles_total: 25, nodes_visited: 1 })
  })

  test('Start Fresh genuinely deletes progress without touching past coin awards, then both bonuses become re-earnable', async ({
    request,
  }) => {
    test.setTimeout(60_000) // ~17 sequential live-network round trips
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    const rowIndices = [15, 16, 17, 18, 19] // row 3, unused by any other test

    for (const i of rowIndices.slice(0, 4)) {
      await completeTile(request, tileIds[i], tokenA, guestTokenA)
    }
    const lineResult = await completeTile(request, tileIds[rowIndices[4]], tokenA, guestTokenA)
    expect(lineResult.coins_awarded).toBe(10)

    const staffToken = await apiStaffLogin(request)
    const [ticketBooth, restrooms] = await closeOtherTopLevelNodes(request, staffToken)
    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)
    const explorationResult = await visitNode(request, tokenA, restrooms.id, guestTokenA)
    expect(explorationResult.coins_awarded).toBe(50)

    const totalBeforeStartFresh = await getCoinsTotal(request, tokenA, guestTokenA)
    expect(totalBeforeStartFresh).toBe(60)

    const statusBefore = await getBingoMapStatus(request, tokenA, guestTokenA)
    expect(statusBefore).toEqual({ has_progress: true, tiles_completed: 5, tiles_total: 25, nodes_visited: 2 })

    const freshResult = await startFresh(request, tokenA, guestTokenA)
    expect(freshResult).toEqual({ bingo_tiles_reset: 5, map_nodes_reset: 2 })

    // Genuinely deleted -- proven via the status endpoint, not inferred.
    const statusAfter = await getBingoMapStatus(request, tokenA, guestTokenA)
    expect(statusAfter).toEqual({ has_progress: false, tiles_completed: 0, tiles_total: 25, nodes_visited: 0 })

    // The decisive check review asked for: the guest's coin total is
    // UNCHANGED immediately after Start Fresh. coin_awards is append-only --
    // the original bingo-milestone and map-exploration awards are still
    // there, untouched, not clawed back. If re-earnability below worked only
    // because this ledger had been silently rewritten, this assertion would
    // catch it.
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(totalBeforeStartFresh)

    // Only now, re-driving the same line and the same exploration set to
    // completion again: NEW coin awards land, proving re-earnability comes
    // from the completions/visits genuinely being gone (Bingo, derived live
    // off session_tile_completions) and from guests.bingo_map_reset_at (Map
    // Exploration, whose guard checks the append-only coin_awards ledger and
    // needed that explicit boundary -- see _check_map_exploration_bonus).
    for (const i of rowIndices.slice(0, 4)) {
      await completeTile(request, tileIds[i], tokenA, guestTokenA)
    }
    const secondLineResult = await completeTile(request, tileIds[rowIndices[4]], tokenA, guestTokenA)
    expect(secondLineResult.coins_awarded).toBe(10)

    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)
    const secondExplorationResult = await visitNode(request, tokenA, restrooms.id, guestTokenA)
    expect(secondExplorationResult.coins_awarded).toBe(50)

    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(totalBeforeStartFresh + 10 + 50)
  })

  test('Reset Session (logout) on a linked device leaves Bingo/Map progress intact, and a later login restores it', async ({
    request,
  }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    await completeTile(request, tileIds[2], tokenA, guestTokenA)

    const staffToken = await apiStaffLogin(request)
    const [ticketBooth] = await closeOtherTopLevelNodes(request, staffToken)
    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)

    const resetResult = await resetSessionApi(request, tokenA, guestTokenA)
    expect(resetResult.guest_logged_out).toBe(true)
    // Nothing was deleted -- preserved via this (now-retired) session's
    // still-set guest_id, not by copying rows elsewhere.
    expect(resetResult.bingo_tiles_reset).toBe(0)
    expect(resetResult.map_nodes_reset).toBe(0)

    const guestTokenA2 = await login(request, tokenA, email)
    const status = await getBingoMapStatus(request, tokenA, guestTokenA2)
    expect(status.tiles_completed).toBe(1)
    expect(status.nodes_visited).toBe(1)

    const card = await getCard(request, cardId, tokenA, guestTokenA2)
    expect(card.tiles[2].completed).toBe(true)
  })

  test('anonymous behavior is unchanged: current-session-only, still wiped by Reset Session', async ({ request }) => {
    const tokenAnon = crypto.randomUUID()
    await resetSessionApi(request, tokenAnon)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenAnon)
    await completeTile(request, tileIds[3], tokenAnon) // no guest header at all

    const cardBefore = await getCard(request, cardId, tokenAnon)
    expect(cardBefore.tiles[3].completed).toBe(true)

    const resetResult = await resetSessionApi(request, tokenAnon)
    expect(resetResult.guest_logged_out).toBe(false)
    expect(resetResult.bingo_tiles_reset).toBe(1)

    const cardAfter = await getCard(request, cardId, tokenAnon)
    expect(cardAfter.tiles[3].completed).toBe(false)
  })

  test('after Reset Session logs a guest out, a DIFFERENT anonymous person picking up the same device sees none of that guest\'s Bingo/Map progress', async ({
    request,
  }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    await completeTile(request, tileIds[4], tokenA, guestTokenA)

    const staffToken = await apiStaffLogin(request)
    const [ticketBooth] = await closeOtherTopLevelNodes(request, staffToken)
    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)

    const resetResult = await resetSessionApi(request, tokenA, guestTokenA)
    expect(resetResult.guest_logged_out).toBe(true)

    // The next person's device session -- a brand new token, exactly what
    // rotateDeviceSessionId() mints, with NO X-Guest-Auth header at all.
    const tokenNext = crypto.randomUUID()
    const cardNext = await getCard(request, cardId, tokenNext)
    expect(cardNext.tiles[4].completed).toBe(false)
    const nodesNext = await getMapNodes(request, tokenNext)
    expect(nodesNext.find((n) => n.id === ticketBooth.id)!.visited).toBe(false)

    // Adversarial: even if guest A's now-invalidated token somehow rode
    // along, get_optional_guest treats an invalid token as anonymous, so
    // this must still read as session-scoped (nothing), not guest A's data.
    const cardNextWithStaleToken = await getCard(request, cardId, tokenNext, guestTokenA)
    expect(cardNextWithStaleToken.tiles[4].completed).toBe(false)

    // The decisive check, in the other direction: guest A's own progress,
    // read via an entirely independent later login, is still fully intact.
    const tokenC = crypto.randomUUID()
    const guestTokenA2 = await login(request, tokenC, email)
    const cardViaC = await getCard(request, cardId, tokenC, guestTokenA2)
    expect(cardViaC.tiles[4].completed).toBe(true)
  })

  test('the Welcome Back prompt shows correct numbers on login, Continue keeps progress, and Start Fresh clears it in the UI', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    await completeTile(request, tileIds[5], tokenA, guestTokenA)
    await completeTile(request, tileIds[6], tokenA, guestTokenA)

    const staffToken = await apiStaffLogin(request)
    const [ticketBooth] = await closeOtherTopLevelNodes(request, staffToken)
    await visitNode(request, tokenA, ticketBooth.id, guestTokenA)

    // A second, brand new device logging in for the first time.
    const tokenB = crypto.randomUUID()
    await seedDeviceSession(page, tokenB)
    await page.goto('/')
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible()
    await expect(page.getByText('2/25 Bingo tiles')).toBeVisible()
    await expect(page.getByText('1 map node visited')).toBeVisible()

    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).not.toBeVisible()

    // Continue needed no action beyond dismissing the prompt -- the backend
    // reads are already guest-aware, proven directly rather than assumed.
    const cardAfterContinue = await getCard(request, cardId, tokenB, guestTokenA)
    expect(cardAfterContinue.tiles[5].completed).toBe(true)
    expect(cardAfterContinue.tiles[6].completed).toBe(true)

    // Log out on device B, then log back in again to trigger a second
    // Welcome Back prompt -- this time exercising Start Fresh.
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: email }).click()
    await page.getByRole('button', { name: 'Log Out' }).click()

    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible()
    await page.getByRole('button', { name: 'Start Fresh' }).click()
    await expect(page.getByRole('heading', { name: 'Start Fresh?' })).toBeVisible()
    await page.getByRole('button', { name: 'Start Fresh' }).click()
    await expect(page.getByRole('heading', { name: 'Start Fresh?' })).not.toBeVisible()

    const guestTokenAfter = (await page.evaluate(() => localStorage.getItem('cap-guest-auth-token')))!
    const status = await getBingoMapStatus(request, tokenB, guestTokenAfter)
    expect(status).toEqual({ has_progress: false, tiles_completed: 0, tiles_total: 25, nodes_visited: 0 })
  })
})
