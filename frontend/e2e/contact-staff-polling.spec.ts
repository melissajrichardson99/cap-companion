import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin, loginAsStaff } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { closeNavMenu, openNavMenu, openTab } from './navMenuHelper'

const API = 'http://localhost:8000'
const POLL_MS = 15_000

// Contact Staff status polling (App.tsx + useVisibleInterval.ts): no timer
// at all while the guest has no active request, a 15s poll only while one is
// open/acknowledged, paused in a hidden tab with one immediate check on
// return, and never more than one timer. Runs on Playwright's fake clock
// (page.clock), so "ten minutes idle" costs no real time; requests are
// counted from the page's own request events.

interface RequestCounter {
  n: number
  pending: number
}

// Counts this page's GET requests whose path (and query, if given) match,
// and tracks how many of them are still in flight.
function countRequests(page: Page, matches: (url: URL) => boolean): RequestCounter {
  const counter = { n: 0, pending: 0 }
  const tracked = new Set<unknown>()
  page.on('request', (req) => {
    if (req.method() !== 'GET' || !matches(new URL(req.url()))) return
    tracked.add(req)
    counter.n += 1
    counter.pending += 1
  })
  const done = (req: unknown) => {
    if (tracked.delete(req)) counter.pending -= 1
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return counter
}

// GET /staff-requests/mine only (not /mine/cancel).
function countMineRequests(page: Page) {
  return countRequests(page, (url) => url.pathname === '/staff-requests/mine')
}

// Lets anything the page just fired show up as a request event, then waits
// for all of it to land. (waitForLoadState('networkidle') can't do this: it
// returns at once if the page has ever been idle since load.)
async function waitQuiet(counter: RequestCounter) {
  await new Promise((resolve) => setTimeout(resolve, 400))
  await expect.poll(() => counter.pending).toBe(0)
}

// Exactly `n` matching requests so far, and no more on their way.
async function expectCount(counter: RequestCounter, n: number) {
  await expect.poll(() => counter.n).toBe(n)
  await waitQuiet(counter)
  expect(counter.n).toBe(n)
}

// Lets a test flip the Page Visibility API without a real second window:
// document.hidden / visibilityState read a page-controlled flag, and
// setHidden dispatches the visibilitychange event a real tab switch would.
async function installVisibilityControl(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __testHidden: boolean }
    w.__testHidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__testHidden })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (w.__testHidden ? 'hidden' : 'visible'),
    })
  })
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    ;(window as unknown as { __testHidden: boolean }).__testHidden = h
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

// Fresh device token with an open request already on it, created through
// the API so the page's very first status check finds it.
async function deviceWithOpenRequest(request: APIRequestContext) {
  const token = crypto.randomUUID()
  const res = await request.post(`${API}/staff-requests`, {
    ...withSession(token),
    data: { type: 'question', location_node_id: null, name: null, description: null },
  })
  expect(res.ok()).toBe(true)
  const mine = await (await request.get(`${API}/staff-requests/mine`, withSession(token))).json()
  return { token, requestId: mine.id as string }
}

async function staffAction(request: APIRequestContext, requestId: string, action: 'acknowledge' | 'resolve') {
  const staffToken = await apiStaffLogin(request)
  const res = await request.post(`${API}/staff-requests/${requestId}/${action}`, {
    headers: { Authorization: `Bearer ${staffToken}` },
  })
  expect(res.ok()).toBe(true)
}

// Loads Home and waits out the load-time status check (1-2 calls: StrictMode
// runs mount effects twice in dev).
async function loadHome(page: Page, mine: RequestCounter) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
  await expect.poll(() => mine.n).toBeGreaterThanOrEqual(1)
  await waitQuiet(mine)
  expect(mine.n).toBeLessThanOrEqual(2)
}

async function expectNavContactLabel(page: Page, name: string) {
  await openNavMenu(page)
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await closeNavMenu(page)
}

test.describe('Contact Staff status polling', () => {
  test('with no active request: one check on load, then no repeated calls over a long idle period', async ({
    page,
  }) => {
    await page.clock.install()
    const mine = countMineRequests(page)
    await loadHome(page, mine)
    const afterLoad = mine.n

    await page.clock.runFor(10 * 60_000)
    await expectCount(mine, afterLoad)
  })

  test('submitting starts the poll, a staff change reaches the guest, and resolution stops it', async ({
    page,
    request,
  }) => {
    const token = crypto.randomUUID()
    await seedDeviceSession(page, token)
    await page.clock.install()
    const mine = countMineRequests(page)
    await loadHome(page, mine)

    // Idle before submitting: nothing on the timer.
    await page.clock.runFor(2 * 60_000)
    await expectCount(mine, mine.n)

    await openNavMenu(page)
    await page.getByRole('button', { name: 'Contact Staff' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Restrooms', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(dialog.getByText('Question sent')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expectNavContactLabel(page, 'Contact Staff — request open')
    await waitQuiet(mine)

    // Polling now: one call per interval.
    let before = mine.n
    await page.clock.runFor(POLL_MS * 4)
    await expectCount(mine, before + 4)

    // Staff acknowledges; the next tick shows it to the guest.
    const { id: requestId } = await (await request.get(`${API}/staff-requests/mine`, withSession(token))).json()
    await staffAction(request, requestId, 'acknowledge')
    before = mine.n
    await page.clock.runFor(POLL_MS)
    await expectCount(mine, before + 1)
    await expect(page.getByText('\u{1F44B} Staff has seen your request and is on the way!')).toBeVisible()
    await expectNavContactLabel(page, 'Contact Staff — request acknowledged')

    // Staff resolves; the next tick sees no active request and the poll stops.
    await staffAction(request, requestId, 'resolve')
    before = mine.n
    await page.clock.runFor(POLL_MS)
    await expectCount(mine, before + 1)
    await expectNavContactLabel(page, 'Contact Staff')
    await page.clock.runFor(10 * 60_000)
    await expectCount(mine, before + 1)
  })

  test('a hidden tab makes no calls; becoming visible makes one immediate call, then the interval resumes', async ({
    page,
    request,
  }) => {
    const { token, requestId } = await deviceWithOpenRequest(request)
    await seedDeviceSession(page, token)
    await installVisibilityControl(page)
    await page.clock.install()
    const mine = countMineRequests(page)
    await loadHome(page, mine)

    try {
      await setHidden(page, true)
      const hiddenAt = mine.n
      await page.clock.runFor(10 * 60_000)
      await expectCount(mine, hiddenAt)

      await setHidden(page, false)
      await expectCount(mine, hiddenAt + 1)

      // The interval restarts from that refresh: nothing until a full
      // interval has passed, then one call per interval again.
      await page.clock.runFor(POLL_MS - 1_000)
      await expectCount(mine, hiddenAt + 1)
      await page.clock.runFor(1_000)
      await expectCount(mine, hiddenAt + 2)
    } finally {
      await staffAction(request, requestId, 'resolve')
    }
  })

  test('navigating away and back leaves exactly one poll timer', async ({ page, request }) => {
    const { token, requestId } = await deviceWithOpenRequest(request)
    await seedDeviceSession(page, token)
    await page.clock.install()
    const mine = countMineRequests(page)
    await loadHome(page, mine)

    try {
      const hops: [string, string][] = [
        ['Map', '/map'],
        ['Bingo Card', '/bingo'],
        ['Home', '/'],
        ['Map', '/map'],
        ['Home', '/'],
      ]
      for (const [tab, path] of hops) {
        await openTab(page, tab)
        await expect(page).toHaveURL((url) => url.pathname === path)
      }
      await waitQuiet(mine)

      const before = mine.n
      await page.clock.runFor(POLL_MS * 4)
      await expectCount(mine, before + 4)
    } finally {
      await staffAction(request, requestId, 'resolve')
    }
  })

  test("the Staff page's poll pauses in a hidden tab and reloads once on return", async ({ page }) => {
    await installVisibilityControl(page)
    await page.clock.install()
    const staffList = countRequests(
      page,
      (url) => url.pathname === '/staff-requests' && url.searchParams.has('include_closed'),
    )
    await loginAsStaff(page)
    await expect.poll(() => staffList.n).toBeGreaterThanOrEqual(1)
    await waitQuiet(staffList)

    // Visible: still polls on its usual interval (unchanged, 12s).
    let before = staffList.n
    await page.clock.runFor(12_000 * 3)
    await expectCount(staffList, before + 3)

    await setHidden(page, true)
    before = staffList.n
    await page.clock.runFor(10 * 60_000)
    await expectCount(staffList, before)

    await setHidden(page, false)
    await expectCount(staffList, before + 1)
  })
})
