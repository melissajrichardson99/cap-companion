import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin, loginAsStaff, readStaffPassword } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'

// Staff Visit Heatmap, Phase 1 (migration 041 / GET /staff/heatmap). Covers:
// - every Map check-in (repeat visits included, via the now-always-visible
//   "Check In Again" button) lands as its own raw event, end to end through
//   the real UI,
// - the heatmap page reflects those events inside the matching
//   date/day/hour window and NOT outside it (and clears stale counts when a
//   filter changes to an empty window),
// - /staff/heatmap and its endpoint are staff-gated like every other staff
//   screen.
//
// Park time, not browser time: the backend buckets day/hour/date filters in
// the park's fixed zone (America/Edmonton), so "today"/"this hour" below are
// computed in PARK_TZ. The browser is deliberately pinned to a very
// different zone (Asia/Tokyo, usually a different calendar day) to prove
// the page's results don't depend on the viewer's timezone. Events accumulate across runs (the event table is never reset), so
// the "inside the window" assertion is a before/after delta (workers: 1 in
// playwright.config.ts keeps it exact); the "outside the window" assertions
// use windows that are empty by construction (another weekday within a
// today-only range, and hours later than now).

const API = 'http://localhost:8000'
const PARK_TZ = 'America/Edmonton'
const BROWSER_TZ = 'Asia/Tokyo'
const NODE_NAME = 'Ticket Booth' // zero linked Bingo tiles -> single-click visit, no confirmation popups
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

test.use({ timezoneId: BROWSER_TZ })

function nowInParkTime(): { date: string; weekday: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: PARK_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday.toLowerCase(), hour: Number(parts.hour) }
}

async function nodeId(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.get(`${API}/map/nodes`, withSession(crypto.randomUUID()))
  const rows = (await res.json()) as { id: string; name: string }[]
  return rows.find((r) => r.name === name)!.id
}

async function apiHeatmapCount(request: APIRequestContext, staffToken: string, id: string, query: string): Promise<number> {
  const res = await request.get(`${API}/staff/heatmap?${query}`, {
    headers: { Authorization: `Bearer ${staffToken}` },
  })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { counts: { source_id: string; visits: number }[] }
  return body.counts.find((c) => c.source_id === id)?.visits ?? 0
}

async function checkInViaMap(page: Page, buttonName: 'Mark Visited' | 'Check In Again'): Promise<void> {
  await page.locator(`.map-pin[aria-label^="${NODE_NAME}"]`).click()
  const dialog = page.getByRole('dialog', { name: NODE_NAME })
  await dialog.getByRole('button', { name: buttonName }).click()
  await expect(dialog).toHaveCount(0)
}

function dot(page: Page) {
  return page.locator(`.staff-heatmap-dot[data-node-name="${NODE_NAME}"]`)
}

test('every Map check-in (first visit and repeats) shows on the staff heatmap inside its date/day/hour window, and not outside it', async ({
  page,
  context,
  request,
}) => {
  const staffToken = await apiStaffLogin(request)
  const id = await nodeId(request, NODE_NAME)
  const now = nowInParkTime()
  // Current hour +/- 1 (clamped), so a check-in that straddles an hour
  // boundary mid-test still lands inside the window.
  const hourStart = Math.max(0, now.hour - 1)
  const hourEnd = Math.min(24, now.hour + 2)
  const windowQuery = `start=${now.date}&end=${now.date}&day=${now.weekday}&hour_start=${hourStart}&hour_end=${hourEnd}`
  const before = await apiHeatmapCount(request, staffToken, id, windowQuery)

  // Guest: fresh device session, first visit + one repeat check-in. Before
  // this ticket the button vanished after the first visit and the repeat
  // never reached the backend.
  await seedDeviceSession(page, crypto.randomUUID())
  await page.goto('/map')
  await checkInViaMap(page, 'Mark Visited')
  await checkInViaMap(page, 'Check In Again')
  // Bingo/Map completion state is unchanged by the repeat: still just "Visited".
  await page.locator(`.map-pin[aria-label^="${NODE_NAME}"]`).click()
  await expect(page.getByRole('dialog', { name: NODE_NAME }).locator('.state-pill')).toHaveText('Visited')
  // Event rows are written by a background task after the visit response is
  // sent, so poll until both have landed before the staff page fetches.
  await expect.poll(() => apiHeatmapCount(request, staffToken, id, windowQuery), { timeout: 10_000 }).toBe(before + 2)

  // Staff: the heatmap page, filtered to exactly that window.
  // Straight to the page, not via Analytics -> "Open Visit Heatmap": that
  // link only renders after the full analytics summary loads (~17s on the
  // dev DB), which pushed this test past the 30s default. The link itself is
  // covered by its own test below.
  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await staffPage.goto('/staff/heatmap')
  await expect(staffPage.getByTestId('heatmap-tz-note')).toContainText('park time')
  // The browser really is in Tokyo, and the page must not forward that zone.
  expect(await staffPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(BROWSER_TZ)
  const heatmapRequests: URL[] = []
  staffPage.on('request', (req) => {
    if (req.url().includes('/staff/heatmap?')) heatmapRequests.push(new URL(req.url()))
  })

  await staffPage.getByRole('button', { name: 'Custom' }).click()
  await staffPage.getByLabel('Range start').fill(now.date)
  await staffPage.getByLabel('Range end').fill(now.date)
  await staffPage.getByLabel('Day of week').selectOption(now.weekday)
  await staffPage.getByLabel('Hour start').selectOption(String(hourStart))
  await staffPage.getByLabel('Hour end').selectOption(String(hourEnd))

  await expect(dot(staffPage)).toHaveAttribute('data-visits', String(before + 2), { timeout: 15_000 })
  await expect(staffPage.locator(`.staff-heatmap-table tr[data-node-name="${NODE_NAME}"] td`).nth(1)).toHaveText(
    String(before + 2),
  )

  // Outside the window, by day: any other weekday within a today-only range
  // is empty by construction -- and the map must repaint to neutral, not
  // keep the previous filter's colors.
  const otherDay = WEEKDAYS[(WEEKDAYS.indexOf(now.weekday) + 1) % 7]
  await staffPage.getByLabel('Day of week').selectOption(otherDay)
  await expect(staffPage.getByTestId('heatmap-total')).toHaveText('0 visits in this window')
  await expect(dot(staffPage)).toHaveAttribute('data-visits', '0')
  await expect(staffPage.locator('.staff-heatmap-dot:not(.staff-heatmap-dot-zero)')).toHaveCount(0)

  // Back inside the window -> the counts come back.
  await staffPage.getByLabel('Day of week').selectOption(now.weekday)
  await expect(dot(staffPage)).toHaveAttribute('data-visits', String(before + 2))

  // Outside the window, by hour: later today hasn't happened yet.
  if (now.hour + 2 < 24) {
    await staffPage.getByLabel('Hour start').selectOption(String(now.hour + 2))
    await staffPage.getByLabel('Hour end').selectOption('24')
    await expect(staffPage.getByTestId('heatmap-total')).toHaveText('0 visits in this window')
    await expect(dot(staffPage)).toHaveAttribute('data-visits', '0')
  }

  // Outside the window, by date range.
  await staffPage.getByLabel('Day of week').selectOption('')
  await staffPage.getByLabel('Hour start').selectOption('')
  await staffPage.getByLabel('Hour end').selectOption('')
  await staffPage.getByLabel('Range start').fill('2020-01-01')
  await staffPage.getByLabel('Range end').fill('2020-01-02')
  await expect(staffPage.getByTestId('heatmap-total')).toHaveText('0 visits in this window')
  await expect(dot(staffPage)).toHaveAttribute('data-visits', '0')
  await expect(staffPage.getByText(/Couldn't load heatmap/)).toHaveCount(0)

  expect(heatmapRequests.length).toBeGreaterThan(0)
  expect(heatmapRequests.filter((u) => u.searchParams.has('tz'))).toEqual([])
})

test('/staff/heatmap shows the staff login screen without a staff session, then the heatmap after logging in', async ({ page }) => {
  await page.goto('/staff/heatmap')
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.locator('.staff-heatmap')).toHaveCount(0)

  await page.getByLabel('Password').fill(readStaffPassword())
  await page.getByRole('button', { name: 'Log In' }).click()
  await expect(page.getByRole('heading', { name: 'Visit Heatmap' })).toBeVisible()
  await expect(page).toHaveURL(/\/staff\/heatmap$/)
})

test('the Analytics tab links to the Visit Heatmap', async ({ page }) => {
  // The link only renders once GET /analytics/summary has loaded. That
  // summary makes many sequential, paginated Supabase calls over every
  // device session ever created, so it slows as e2e data accumulates on the
  // dev DB (~17s at the time of writing). Hence a larger timeout for this
  // test only, rather than a global one.
  test.setTimeout(90_000)
  await loginAsStaff(page)
  await page.getByRole('tab', { name: 'Analytics' }).click()
  await page.getByRole('link', { name: 'Open Visit Heatmap' }).click({ timeout: 75_000 })
  await expect(page).toHaveURL(/\/staff\/heatmap$/)
  await expect(page.getByRole('heading', { name: 'Visit Heatmap' })).toBeVisible()
})

test('GET /staff/heatmap rejects requests without a valid staff Authorization header', async ({ request }) => {
  const noAuth = await request.get(`${API}/staff/heatmap?start=2020-01-01&end=2020-01-02`)
  expect(noAuth.status()).toBe(401)
  const badAuth = await request.get(`${API}/staff/heatmap?start=2020-01-01&end=2020-01-02`, {
    headers: { Authorization: 'Bearer not-a-real-token' },
  })
  expect(badAuth.status()).toBe(401)
})
