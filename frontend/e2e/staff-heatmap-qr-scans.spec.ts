import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin, loginAsStaff } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { ANIMALS } from '../src/animalContent'

// Staff Visit Heatmap, Phase 2 (migration 042 / POST /scan-events). Covers:
// - for each of the four QR destination types, a scan through the in-app
//   modal (manual code entry) and an arrival by direct URL load (a phone's
//   own camera app) each log exactly one event -- the dev server runs React
//   StrictMode, so "exactly one" also proves no double-invoked effect logs
//   twice -- and land on the right (top-level) node of the heatmap,
// - browsing to the same destination from inside the app, or reloading a
//   QR landing page, logs nothing,
// - an unmapped destination logs as unmapped and shows in the unmapped count,
// - the Source filter (All / Check-ins / QR scans) and the per-source table
//   columns,
// - staff auth on the new endpoints, and unknown-destination rejection.
//
// Events accumulate across runs (the event table is never reset), so every
// count assertion is a before/after delta (workers: 1 keeps it exact). The
// window is yesterday..tomorrow in park time so a run straddling park
// midnight still lands inside it. Each arrival uses a fresh device session,
// so the backend's per-device double-fire debounce never absorbs one.

const API = 'http://localhost:8000'
const PARK_TZ = 'America/Edmonton'

interface Destination {
  label: string
  // Manual code a guest types into ScanEntryModal.
  code: string
  // QR landing path (what the printed QR's URL opens).
  path: string
  // Top-level heatmap node the scan rolls up to (via the seeded mapping).
  node: string
  // Heading visible once the destination has loaded.
  landed: (page: Page) => Promise<void>
}

const DESTINATIONS: Destination[] = [
  {
    label: 'Hunt character (Kangaroo)',
    code: 'brave-otter',
    path: '/scan/brave-otter',
    node: 'Kangaroos/Wallaroos',
    landed: (page) => expect(page.getByRole('heading', { name: 'Kangaroo' }).first()).toBeVisible(),
  },
  {
    label: 'Animal (Goat)',
    code: 'goat',
    path: '/animals/goat',
    node: 'Goats',
    landed: (page) => expect(page.getByRole('heading', { name: 'Goat', exact: true })).toBeVisible(),
  },
  {
    // Cornhole is a child of Arcade Pad -- proves the roll-up to the pin.
    label: 'Scoring game (Cornhole)',
    code: 'cornhole',
    path: '/scoring/cornhole',
    node: 'Arcade Pad',
    landed: (page) => expect(page.getByRole('dialog')).toBeVisible(),
  },
  {
    // Stroke-play mini golf (migration 043): each course has its own
    // top-level pin, so no roll-up.
    label: 'Scoring game (Blacklight Mini Golf)',
    code: 'blacklight-mini-golf',
    path: '/scoring/blacklight-mini-golf',
    node: 'Blacklight Mini Golf',
    landed: (page) => expect(page.getByRole('dialog').getByRole('button', { name: 'Begin Round' })).toBeVisible(),
  },
  {
    label: 'Scoring game (Cornhole Mini Golf)',
    code: 'cornhole-mini-golf',
    path: '/scoring/cornhole-mini-golf',
    node: 'Cornhole Mini Golf',
    landed: (page) => expect(page.getByRole('dialog').getByRole('button', { name: 'Begin Round' })).toBeVisible(),
  },
  {
    // Math Maze is a child of Ground Games.
    label: 'Puzzle challenge (Math Maze Standard)',
    code: 'math-maze-standard',
    path: '/puzzles/math-maze-standard',
    node: 'Ground Games',
    landed: (page) => expect(page.getByRole('dialog')).toBeVisible(),
  },
]

function parkDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

const WINDOW = `start=${parkDate(-1)}&end=${parkDate(1)}`

interface Heatmap {
  total_visits: number
  counts: { source_id: string; visits: number; check_ins: number; scans: number }[]
  unmapped_scans: number
  unmapped: { destination_type: string; destination_id: string; scans: number }[]
}

async function heatmap(request: APIRequestContext, staffToken: string, source = 'all'): Promise<Heatmap> {
  const res = await request.get(`${API}/staff/heatmap?${WINDOW}&source=${source}`, {
    headers: { Authorization: `Bearer ${staffToken}` },
  })
  expect(res.ok()).toBe(true)
  return (await res.json()) as Heatmap
}

async function nodeIds(request: APIRequestContext): Promise<Map<string, string>> {
  const res = await request.get(`${API}/map/nodes`, withSession(crypto.randomUUID()))
  const rows = (await res.json()) as { id: string; name: string }[]
  return new Map(rows.map((r) => [r.name, r.id]))
}

async function scansAt(request: APIRequestContext, staffToken: string, nodeId: string): Promise<number> {
  return (await heatmap(request, staffToken, 'qr_scan')).counts.find((c) => c.source_id === nodeId)?.scans ?? 0
}

async function unmappedScans(request: APIRequestContext, staffToken: string, type: string, id: string): Promise<number> {
  const body = await heatmap(request, staffToken, 'qr_scan')
  return body.unmapped.find((u) => u.destination_type === type && u.destination_id === id)?.scans ?? 0
}

// Counts the page's POST /scan-events calls -- a direct, timing-free check
// that an arrival fires exactly one and that browsing fires none.
function countScanPosts(page: Page): { count: () => number } {
  let n = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/scan-events')) n++
  })
  return { count: () => n }
}

async function freshGuest(page: Page): Promise<{ count: () => number }> {
  await seedDeviceSession(page, crypto.randomUUID())
  return countScanPosts(page)
}

async function scanViaModal(page: Page, code: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.locator('#nav-menu-panel').getByRole('button', { name: 'Scan QR' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel("What's on the sign").fill(code)
  await modal.getByRole('button', { name: 'Go' }).click()
}

// Events are written by a background task after the response, so poll; then
// hold briefly and re-check, so a late duplicate would also be caught.
async function expectScans(read: () => Promise<number>, expected: number): Promise<void> {
  await expect.poll(read, { timeout: 10_000 }).toBe(expected)
  await new Promise((r) => setTimeout(r, 1_000))
  expect(await read()).toBe(expected)
}

test.describe('QR scans on the staff heatmap', () => {
  let staffToken: string
  let ids: Map<string, string>

  test.beforeAll(async ({ request }) => {
    staffToken = await apiStaffLogin(request)
    ids = await nodeIds(request)
  })

  for (const dest of DESTINATIONS) {
    test(`${dest.label}: in-app manual entry and a direct URL load each log exactly one scan`, async ({
      page,
      request,
    }) => {
      const nodeId = ids.get(dest.node)!
      const before = await scansAt(request, staffToken, nodeId)

      const viaModal = await freshGuest(page)
      await scanViaModal(page, dest.code)
      await expect(page).toHaveURL(new RegExp(`${dest.path}$`))
      await dest.landed(page)
      await expectScans(() => scansAt(request, staffToken, nodeId), before + 1)
      expect(viaModal.count()).toBe(1)

      // Reloading the landing page is not a new scan.
      await page.reload()
      await dest.landed(page)
      expect(viaModal.count()).toBe(1)

      const page2 = await page.context().newPage()
      const viaUrl = await freshGuest(page2)
      await page2.goto(dest.path)
      await dest.landed(page2)
      await expectScans(() => scansAt(request, staffToken, nodeId), before + 2)
      expect(viaUrl.count()).toBe(1)

      await page2.reload()
      await dest.landed(page2)
      expect(viaUrl.count()).toBe(1)
      await expectScans(() => scansAt(request, staffToken, nodeId), before + 2)
    })
  }

  test('browsing to each destination from inside the app logs nothing', async ({ page }) => {
    const posts = await freshGuest(page)
    const openTab = async (name: string) => {
      await page.goto('/')
      await page.getByRole('button', { name: 'Open menu' }).click()
      await page.getByRole('menuitemradio', { name }).click()
    }

    // Our Animals list -> Goat detail (/animals/goat, by in-app navigation).
    await openTab('Our Animals')
    await page.locator('.animal-card', { hasText: 'Goat' }).click()
    await expect(page).toHaveURL(/\/animals\/goat$/)
    await expect(page.getByRole('heading', { name: 'Goat', exact: true })).toBeVisible()

    // Scoring Sheet -> Cornhole.
    await openTab('Scoring Sheets')
    await page
      .locator('.scoring-game-card')
      .filter({ has: page.getByRole('heading', { name: 'Cornhole', exact: true }) })
      .getByRole('button', { name: 'Start Scoring' })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Puzzles -> Math Maze Standard.
    await openTab('Puzzles')
    await page.locator('.puzzle-card', { hasText: 'Math Maze' }).getByRole('button', { name: 'Standard' }).click()
    await expect(page.getByRole('dialog').getByText('Math Maze — Standard')).toBeVisible()

    // Scavenger Hunt list.
    await openTab('Scavenger Hunt')
    await expect(page.locator('.hunt-character-card').first()).toBeVisible()

    expect(posts.count()).toBe(0)
  })

  test('a scan of an unmapped destination is recorded as unmapped, shown on the heatmap page, and does not error', async ({
    page,
    context,
    request,
  }) => {
    // Sloth has no seeded location (migration 042).
    const before = await unmappedScans(request, staffToken, 'animal', 'sloth')
    const beforeAll = await heatmap(request, staffToken)

    await freshGuest(page)
    await page.goto('/animals/sloth')
    await expect(page.getByRole('heading', { name: 'Sloth', exact: true })).toBeVisible()
    await expectScans(() => unmappedScans(request, staffToken, 'animal', 'sloth'), before + 1)
    // Not counted against any node.
    expect((await heatmap(request, staffToken)).total_visits).toBe(beforeAll.total_visits)

    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.goto(`/staff/heatmap`)
    await staffPage.getByRole('button', { name: 'Custom' }).click()
    await staffPage.getByLabel('Range start').fill(parkDate(-1))
    await staffPage.getByLabel('Range end').fill(parkDate(1))
    const note = staffPage.getByTestId('heatmap-unmapped')
    await expect(note).toContainText(`${beforeAll.unmapped_scans + 1} unmapped QR scan`)
    await expect(note).toContainText(`Animal "sloth" (${before + 1})`)
    await expect(staffPage.getByText(/Couldn't load heatmap/)).toHaveCount(0)
    // Check-ins only: no unmapped note at all.
    await staffPage.getByLabel('Source').selectOption('map_node')
    await expect(staffPage.getByTestId('heatmap-total')).toBeVisible()
    await expect(note).toHaveCount(0)
  })

  test('each of the 11 newer animals (unmapped): manual entry and a direct URL each log exactly one scan, browsing logs none', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const newAnimals = ANIMALS.slice(9)
    expect(newAnimals).toHaveLength(11)

    for (const animal of newAnimals) {
      const before = await unmappedScans(request, staffToken, 'animal', animal.slug)
      const landed = (p: Page) => expect(p.getByRole('heading', { name: animal.name, exact: true })).toBeVisible()

      const viaModal = await freshGuest(page)
      await scanViaModal(page, animal.slug)
      await expect(page).toHaveURL(new RegExp(`/animals/${animal.slug}$`))
      await landed(page)
      await expectScans(() => unmappedScans(request, staffToken, 'animal', animal.slug), before + 1)
      expect(viaModal.count()).toBe(1)

      const page2 = await page.context().newPage()
      const viaUrl = await freshGuest(page2)
      await page2.goto(`/animals/${animal.slug}`)
      await landed(page2)
      await expectScans(() => unmappedScans(request, staffToken, 'animal', animal.slug), before + 2)
      expect(viaUrl.count()).toBe(1)
      await page2.close()
    }

    // Browsing to every one of them from inside the app logs nothing.
    const posts = await freshGuest(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
    for (const animal of newAnimals) {
      await page.locator('.animal-card').filter({ has: page.getByText(animal.name, { exact: true }) }).click()
      await expect(page).toHaveURL(new RegExp(`/animals/${animal.slug}$`))
      await page.getByRole('button', { name: 'Back to Our Animals' }).click()
    }
    expect(posts.count()).toBe(0)
  })

  test('the Source filter splits check-ins from QR scans on the map and in the table', async ({
    page,
    context,
    request,
  }) => {
    const goatsId = ids.get('Goats')!
    const row = (h: Heatmap) => h.counts.find((c) => c.source_id === goatsId) ?? { check_ins: 0, scans: 0, visits: 0 }
    const before = row(await heatmap(request, staffToken))

    // One check-in at Goats (API, zero-tile visit) and one Goat QR scan.
    const token = crypto.randomUUID()
    const visit = await request.post(`${API}/map/nodes/${goatsId}/visit`, {
      ...withSession(token),
      data: { completed_tile_ids: [] },
    })
    expect(visit.ok()).toBe(true)
    await freshGuest(page)
    await page.goto('/animals/goat')
    await expect.poll(async () => row(await heatmap(request, staffToken)).visits, { timeout: 10_000 }).toBe(
      before.visits + 2,
    )

    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.goto('/staff/heatmap')
    await staffPage.getByRole('button', { name: 'Custom' }).click()
    await staffPage.getByLabel('Range start').fill(parkDate(-1))
    await staffPage.getByLabel('Range end').fill(parkDate(1))
    const cells = staffPage.locator('.staff-heatmap-table tr[data-node-name="Goats"] td')
    const dot = staffPage.locator('.staff-heatmap-dot[data-node-name="Goats"]')

    // All (default): visits | check-ins | QR scans.
    await expect(cells).toHaveText(['Goats', String(before.visits + 2), String(before.check_ins + 1), String(before.scans + 1)])
    await expect(dot).toHaveAttribute('data-visits', String(before.visits + 2))

    await staffPage.getByLabel('Source').selectOption('map_node')
    await expect(cells).toHaveText(['Goats', String(before.check_ins + 1), String(before.check_ins + 1), '0'])
    await expect(dot).toHaveAttribute('data-visits', String(before.check_ins + 1))

    await staffPage.getByLabel('Source').selectOption('qr_scan')
    await expect(cells).toHaveText(['Goats', String(before.scans + 1), '0', String(before.scans + 1)])
    await expect(dot).toHaveAttribute('data-visits', String(before.scans + 1))

    await staffPage.getByLabel('Source').selectOption('all')
    await expect(dot).toHaveAttribute('data-visits', String(before.visits + 2))
  })

  test('staff can set and clear a destination location from the QR Code Directory', async ({ page, request }) => {
    // Snake (quick-falcon) has no seeded location; restored to null after.
    await loginAsStaff(page)
    await page.getByRole('tab', { name: 'QR Codes' }).click()
    // Scoped to the Hunt section: Our Animals also has a "Snake" row.
    const picker = page
      .locator('.staff-qr-section')
      .filter({ has: page.getByRole('heading', { name: 'Scavenger Hunt Characters', exact: true }) })
      .getByLabel('Map location for Snake')
    await expect(picker).toHaveValue('')
    await expect(page.getByLabel('Map location for Cornhole', { exact: true })).toHaveValue(ids.get('Cornhole')!)

    try {
      await picker.selectOption({ label: 'Small Animals' })
      await expect(page.getByText('Saved').first()).toBeVisible()
      const before = await scansAt(request, staffToken, ids.get('Small Animals')!)
      const scan = await request.post(`${API}/scan-events`, {
        ...withSession(crypto.randomUUID()),
        data: { type: 'scan', id: 'quick-falcon' },
      })
      expect(scan.status()).toBe(204)
      await expectScans(() => scansAt(request, staffToken, ids.get('Small Animals')!), before + 1)
    } finally {
      await picker.selectOption('')
    }
    await expect(picker).toHaveValue('')
    const rows = (await (
      await request.get(`${API}/staff/qr-locations`, { headers: { Authorization: `Bearer ${staffToken}` } })
    ).json()) as { destination_type: string; destination_id: string; map_node_id: string | null }[]
    expect(rows.filter((r) => r.destination_type === 'hunt_character' && r.map_node_id === ids.get('Small Animals'))).toEqual(
      [],
    )
  })

  test('staff location endpoints require a staff token; the public scan endpoint rejects unknown destinations', async ({
    request,
  }) => {
    expect((await request.get(`${API}/staff/qr-locations`)).status()).toBe(401)
    const put = await request.put(`${API}/staff/qr-locations/animal/sloth`, { data: { map_node_id: null } })
    expect(put.status()).toBe(401)
    const badAuth = await request.get(`${API}/staff/qr-locations`, { headers: { Authorization: 'Bearer nope' } })
    expect(badAuth.status()).toBe(401)

    const session = withSession(crypto.randomUUID())
    for (const data of [
      { type: 'scan', id: 'totally-bogus-code' },
      { type: 'animal', id: 'unicorn' },
      { type: 'scoring', id: 'no-such-game' },
      { type: 'puzzle', id: 'no-such-challenge' },
    ]) {
      const res = await request.post(`${API}/scan-events`, { ...session, data })
      expect(res.status(), JSON.stringify(data)).toBe(404)
    }
    const badType = await request.post(`${API}/scan-events`, { ...session, data: { type: 'bogus', id: 'goat' } })
    expect(badType.status()).toBe(422)

    // An Encyclopedia code is a real code but isn't counted: accepted, no event.
    const before = await heatmap(request, staffToken)
    const encyc = await request.post(`${API}/scan-events`, { ...session, data: { type: 'scan', id: 'jolly-zebra' } })
    expect(encyc.status()).toBe(204)
    await new Promise((r) => setTimeout(r, 1_000))
    const after = await heatmap(request, staffToken)
    expect([after.total_visits, after.unmapped_scans]).toEqual([before.total_visits, before.unmapped_scans])
  })
})
