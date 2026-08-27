import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiStaffLogin } from './staffAuthHelper'
import { withSession } from './deviceSessionHelper'

// Per-Device Sessions Phase 3 (migration 026): map node visited-status moved
// from a single global map_nodes.state column into node_visits, one row per
// (session, node) pair. This file covers what's new: two sessions holding
// independent visited-status for the same node, and the fix to Phase 1's
// documented Map Exploration bonus gap (see
// backend/app/services/map_bingo.py's _check_map_exploration_bonus and
// backend/app/services/session_reset.py's docstring) -- a session that
// hasn't personally finished exploring the map must never collect that
// bonus just because some other concurrent session already has.
//
// Raw HTTP throughout (no `page`): visiting ~30 top-level nodes through the
// UI's tile-confirmation popups per node would be slow and is not what's
// under test here -- see puzzle-timer.spec.ts / collectible-cards.spec.ts
// for the seedDeviceSession(page, token)+withSession(token) pattern this
// file would use if a UI-driven case were ever needed instead.

const API = 'http://localhost:8000'

interface MapNodeRow {
  id: string
  name: string
  visited: boolean
  is_open: boolean
  parent_node_id: string | null
}

async function getMapNodes(request: APIRequestContext, token: string): Promise<MapNodeRow[]> {
  const res = await request.get(`${API}/map/nodes`, withSession(token))
  return res.json()
}

async function setNodeOpen(request: APIRequestContext, staffToken: string, nodeId: string, isOpen: boolean): Promise<void> {
  const res = await request.patch(`${API}/map/nodes/${nodeId}/status`, {
    headers: { Authorization: `Bearer ${staffToken}` },
    data: { is_open: isOpen },
  })
  expect(res.ok()).toBe(true)
}

async function visitNode(request: APIRequestContext, token: string, nodeId: string): Promise<{ coins_awarded: number }> {
  const res = await request.post(`${API}/map/nodes/${nodeId}/visit`, {
    ...withSession(token),
    data: { completed_tile_ids: [] },
  })
  return res.json()
}

async function getCoinsTotal(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withSession(token))
  const body = (await res.json()) as { total: number }
  return body.total
}

test.describe('Map visited-status, per device session', () => {
  // Belt-and-suspenders cleanup for the gap-closure test below, which closes
  // nearly every top-level node -- same pattern as cobb-coins.spec.ts's own
  // afterEach for its Map Exploration tests.
  test.afterEach(async ({ request }) => {
    const staffToken = await apiStaffLogin(request)
    const rows = await getMapNodes(request, crypto.randomUUID())
    const closedTopLevel = rows.filter((r) => r.parent_node_id === null && !r.is_open)
    await Promise.all(closedTopLevel.map((r) => setNodeOpen(request, staffToken, r.id, true)))
  })

  test('two device sessions visiting the same node each have independent visited-status', async ({ request }) => {
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()

    const rows = await getMapNodes(request, tokenA)
    const ticketBooth = rows.find((r) => r.name === 'Ticket Booth')!
    // Zero linked bingo tiles (confirmed in seed.sql), so a plain visit with
    // no completed_tile_ids never trips the tile-confirmation flow.
    expect(rows.find((r) => r.id === ticketBooth.id)!.visited).toBe(false)

    await visitNode(request, tokenA, ticketBooth.id)

    const viewA = await getMapNodes(request, tokenA)
    expect(viewA.find((r) => r.id === ticketBooth.id)!.visited).toBe(true)

    // Session B never visited anything -- its own view of the exact same
    // node is untouched by A's action.
    const viewB = await getMapNodes(request, tokenB)
    expect(viewB.find((r) => r.id === ticketBooth.id)!.visited).toBe(false)
  })

  test('closed gap: a session that has visited nothing does not get the Map Exploration bonus just because another session already finished exploring', async ({
    request,
  }) => {
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    const staffToken = await apiStaffLogin(request)

    // Close every top-level node except two zero-linked-tile service nodes
    // (Ticket Booth, Restrooms -- confirmed in seed.sql), so "every open
    // top-level node" is a small, fast-to-visit set for this test.
    const rows = await getMapNodes(request, tokenA)
    const topLevel = rows.filter((r) => r.parent_node_id === null)
    const ticketBooth = topLevel.find((r) => r.name === 'Ticket Booth')!
    const restrooms = topLevel.find((r) => r.name === 'Restrooms')!
    const others = topLevel.filter((r) => r.id !== ticketBooth.id && r.id !== restrooms.id)
    await Promise.all(others.map((r) => setNodeOpen(request, staffToken, r.id, false)))

    // Session A visits both remaining open nodes itself and earns the bonus
    // on the second visit, once its own node_visits covers the full set.
    await visitNode(request, tokenA, ticketBooth.id)
    const secondVisit = await visitNode(request, tokenA, restrooms.id)
    expect(secondVisit.coins_awarded).toBe(50)
    expect(await getCoinsTotal(request, tokenA)).toBe(50)

    // Session B has visited nothing at all -- the old, now-closed gap was
    // scoped to a session that visits *something*, but the base case (never
    // visits anything) must obviously stay at 0 too.
    expect(await getCoinsTotal(request, tokenB)).toBe(0)

    // The actual gap-closure case: session B now visits ONLY Ticket Booth,
    // not Restrooms. Both nodes are globally is_open, and both are already
    // "explored" by session A -- under the pre-Phase-3 code, the
    // completeness check read the (then-global) map_nodes.state, which
    // already showed both as visited, so this single call would have
    // incorrectly cleared session B's own award guard and paid the bonus
    // even though B never touched Restrooms. Per-session node_visits means
    // B's own completeness check still fails on the node it never visited.
    const bResult = await visitNode(request, tokenB, ticketBooth.id)
    expect(bResult.coins_awarded).toBe(0)
    expect(await getCoinsTotal(request, tokenB)).toBe(0)
  })
})
