import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin, loginAsStaff } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { openNavMenu, openTab } from './navMenuHelper'

// Staff-managed open/closed status (map_nodes.is_open) -- purely visual/
// informational on the guest Map, backed by a column independent of a
// guest's own visit progress (node_visits, Per-Device Sessions Phase 3;
// per-session and wiped by that session's own Reset Session call -- is_open
// must survive it regardless). Ticket Booth is used for the generic-node
// assertions below because it's untouched by every other e2e spec and has
// zero linked bingo tiles, so "Mark Visited" completes in a single click
// with no tile-confirmation queue in the way. Arcade Pad is used for the
// child-inheritance test since it's the parent-node case this feature
// explicitly has to get right.

const API = 'http://localhost:8000'

async function openMapTab(page: Page): Promise<void> {
  await page.goto('/')
  await openTab(page, 'Map')
}

interface MapNodeRow {
  id: string
  name: string
  visited: boolean
  is_open: boolean
}

// GET /map/nodes requires a device session header (Phase 3) -- `token` only
// needs to resolve *a* session for the two tests below that just read the
// global is_open field; the one test that also asserts on `visited` passes
// the same token page's own session is seeded with (see seedDeviceSession).
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

test.describe('Attraction open/closed status', () => {
  // Belt-and-suspenders cleanup regardless of what a test above did or
  // whether it failed partway through -- raw HTTP, no page/UI involved, same
  // pattern as announcements.spec.ts's afterEach.
  test.afterEach(async ({ request }) => {
    const token = await apiStaffLogin(request)
    const rows = await getMapNodes(request, crypto.randomUUID())
    const targets = rows.filter((r) => r.name === 'Ticket Booth' || r.name === 'Arcade Pad')
    await Promise.all(targets.map((r) => setNodeOpen(request, token, r.id, true)))
  })

  test('closing a node via the Staff Page Attractions tab greys its pin, swaps in a lock icon, and appends "(Closed)" to the legend -- reopening restores normal appearance', async ({
    page,
  }) => {
    await loginAsStaff(page)
    await page.getByRole('tab', { name: 'Attractions' }).click()

    const row = page.locator('li[data-node-id]').filter({ hasText: 'Ticket Booth' })
    await expect(row.getByText('Open', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Close' }).click()
    await expect(row.getByText('Closed', { exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Reopen' })).toBeVisible()

    await openMapTab(page)
    const pin = page.locator('.map-pin[aria-label^="Ticket Booth"]')
    await expect(pin).toHaveClass(/map-pin-closed/)
    // Real computed styles, not just the class name -- this app has a
    // documented history of CSS specificity/load-order regressions.
    await expect(pin.locator('.map-pin-shape')).toHaveCSS('opacity', '0.75')
    await expect(pin.locator('.map-pin-shape-text')).toHaveText('\u{1F512}')
    await expect(pin).toHaveAttribute('aria-label', /closed/)

    await page.getByRole('button', { name: /^Service/ }).click()
    const legendItem = page.locator('.map-legend-list li').filter({ hasText: 'Ticket Booth' })
    await expect(legendItem.locator('.map-legend-item-closed')).toHaveText(/\(Closed\)/)

    // Reopen from the Staff Page and confirm the Map reverts. The staff
    // session from loginAsStaff above is still valid -- plain navigation
    // back to /staff, not a second login (the login form isn't rendered for
    // an already-authenticated session, so re-running loginAsStaff here
    // would hang waiting for a password field that's no longer on screen).
    await page.goto('/staff')
    await page.getByRole('tab', { name: 'Attractions' }).click()
    await row.getByRole('button', { name: 'Reopen' }).click()
    await expect(row.getByText('Open', { exact: true })).toBeVisible()

    await openMapTab(page)
    await expect(pin).not.toHaveClass(/map-pin-closed/)
    await expect(pin.locator('.map-pin-shape')).toHaveCSS('opacity', '1')
    await page.getByRole('button', { name: /^Service/ }).click()
    await expect(legendItem.locator('.map-legend-item-closed')).toHaveCount(0)
  })

  test("a closed node's detail popup still opens normally with an additive closed-status message, stays fully completable via Mark Visited, and Reset Session clears its visit progress without reopening it", async ({
    page,
    request,
  }) => {
    const staffToken = await apiStaffLogin(request)
    // A device session explicitly seeded into `page` and reused for the raw
    // getMapNodes calls below, so they observe the same session's visited
    // status `page`'s own UI actions write (Per-Device Sessions Phase 3).
    const deviceToken = crypto.randomUUID()
    await seedDeviceSession(page, deviceToken)

    const rows = await getMapNodes(request, deviceToken)
    const nodeId = rows.find((r) => r.name === 'Ticket Booth')!.id
    await setNodeOpen(request, staffToken, nodeId, false)

    await openMapTab(page)
    await page.locator('.map-pin[aria-label^="Ticket Booth"]').click()
    const dialog = page.getByRole('dialog', { name: 'Ticket Booth' })
    await expect(dialog).toBeVisible()
    // Additive: the normal detail content is untouched...
    await expect(dialog.getByText('Service')).toBeVisible()
    // ...plus the new closed-status note...
    await expect(dialog.getByText('This attraction is currently closed.')).toBeVisible()
    // ...and Mark Visited is still there, not replaced by the closed note.
    await expect(dialog.getByRole('button', { name: 'Mark Visited' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Mark Visited' }).click()
    await expect(dialog).toHaveCount(0)

    let updatedRows = await getMapNodes(request, deviceToken)
    let ticketBooth = updatedRows.find((r) => r.name === 'Ticket Booth')!
    expect(ticketBooth.visited).toBe(true)
    expect(ticketBooth.is_open).toBe(false)

    // Reset Session (NavMenu -> Reset Session -> confirm), same flow as
    // announcements.spec.ts's precedent.
    await openNavMenu(page)
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
    await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
    await expect(resetConfirmDialog).toHaveCount(0)

    updatedRows = await getMapNodes(request, deviceToken)
    ticketBooth = updatedRows.find((r) => r.name === 'Ticket Booth')!
    // Reset Session clears this session's own visit progress as normal...
    expect(ticketBooth.visited).toBe(false)
    // ...but does not touch staff-set closed status.
    expect(ticketBooth.is_open).toBe(false)
  })

  test('closing a parent node (Arcade Pad) closes it on the Map without giving its children any independent surface to also close', async ({
    page,
    request,
  }) => {
    const token = await apiStaffLogin(request)
    const rows = await getMapNodes(request, crypto.randomUUID())
    const nodeId = rows.find((r) => r.name === 'Arcade Pad')!.id
    await setNodeOpen(request, token, nodeId, false)

    await openMapTab(page)
    const pin = page.locator('.map-pin[aria-label^="Arcade Pad"]')
    await expect(pin).toHaveClass(/map-pin-closed/)
    await expect(pin.locator('.map-pin-shape-text')).toHaveText('\u{1F512}')

    // Children never had their own pin/card to begin with (map-parent-child
    // .spec.ts covers that structurally); confirm that still holds with a
    // closed parent, since a future regression here would otherwise leave a
    // child's status silently unrepresented anywhere.
    // Exact-name matches: "Cornhole" is a prefix of the top-level "Cornhole
    // Mini Golf" pin (migration 043), which has a pin of its own. Pin labels
    // read "Name (Category...)", hence the "${child} (" prefix, same as
    // map-parent-child.spec.ts. (Node cards only exist for top-level nodes
    // with no map position, so Cornhole Mini Golf has a pin, not a card.)
    for (const child of ['Cornhole', 'Cornhole Extreme', 'Horse Hoops', 'Tiki Toss/Ring & Hook']) {
      await expect(page.locator(`.map-pin[aria-label^="${child} ("]`)).toHaveCount(0)
      const exactName = new RegExp(`^${child.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      await expect(page.locator('.node-card-name').filter({ hasText: exactName })).toHaveCount(0)
    }

    // The parent's own popup already lists its children by name -- that
    // content stays intact alongside the closed note (additive, not
    // replaced).
    await pin.click()
    const dialog = page.getByRole('dialog', { name: 'Arcade Pad' })
    await expect(dialog.getByText(/Games here:.*Cornhole/)).toBeVisible()
    await expect(dialog.getByText('This attraction is currently closed.')).toBeVisible()
  })
})
