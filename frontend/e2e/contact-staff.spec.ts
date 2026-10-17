import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiStaffLogin, loginAsStaff } from './staffAuthHelper'
import { withSession } from './deviceSessionHelper'
import { openNavMenu } from './navMenuHelper'

const API = 'http://localhost:8000'

// Covers Contact Staff (Plan.md 2.10, migration 010_contact_staff.sql): both
// guest-facing flows (question / emergency) submit with the right location
// attached, the emergency path is genuinely fewer taps than the question
// path, and the staff view (/staff) reflects new requests and status
// changes. Exercised through the staff view's manual Refresh button rather
// than sleeping out the real ~12s poll interval -- Refresh calls the exact
// same reload() the poll timer does, so it covers the same code path.

async function openContactStaff(page: Page) {
  await page.goto('/')
  await openNavMenu(page)
  await page.getByRole('button', { name: 'Contact Staff' }).click()
  return page.getByRole('dialog')
}

test.describe('Contact Staff', () => {
  test('question flow: picking a location does not submit by itself -- an explicit "Submit Question" tap is required', async ({
    page,
  }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await expect(dialog.getByText('Where are you?')).toBeVisible()

    await dialog.getByRole('button', { name: 'Restrooms', exact: true }).click()
    await expect(dialog.getByText('Question sent')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Submit Question' })).toBeEnabled()

    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(dialog.getByText('Question sent')).toBeVisible()

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('emergency flow: tapping a location submits immediately, no separate confirm step', async ({ page }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I need help now' }).click()
    await expect(dialog.getByText('Where are you?')).toBeVisible()

    // No "Submit Question"-style button on this path at all -- the location
    // tap itself is the submission.
    await expect(dialog.getByRole('button', { name: 'Submit Question' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Main Stage', exact: true }).click()
    await expect(dialog.getByText('Help is on the way')).toBeVisible()
  })

  test('emergency path reaches submission in fewer taps than the question path', async ({ page, browser }) => {
    // Question path: menu -> "I have a question" -> pick location -> "Submit
    // Question" -- 3 taps before a request exists.
    const questionDialog = await openContactStaff(page)
    await questionDialog.getByRole('button', { name: 'I have a question' }).click()
    await questionDialog.getByRole('button', { name: 'Ticket Booth', exact: true }).click()
    await expect(questionDialog.getByText('Question sent')).toHaveCount(0) // not submitted yet after 2 taps
    await questionDialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(questionDialog.getByText('Question sent')).toBeVisible() // submitted after a 3rd tap
    await questionDialog.getByRole('button', { name: 'Close' }).click()

    // Emergency path runs on a SEPARATE browser context (its own device
    // session) rather than reusing `page` -- the question flow above just
    // left `page`'s session with an active request, and reopening Contact
    // Staff on a session with an active request now shows the active-request
    // view instead of the menu (see the "active request" test below), which
    // would break this test's actual point (comparing taps-to-submit).
    const emergencyContext = await browser.newContext()
    const emergencyPage = await emergencyContext.newPage()
    const emergencyDialog = await openContactStaff(emergencyPage)
    await emergencyDialog.getByRole('button', { name: 'I need help now' }).click()
    // Menu -> "I need help now" -> pick location -- already submitted after
    // only 2 taps, one fewer than the question path.
    await emergencyDialog.getByRole('button', { name: 'Ticket Booth', exact: true }).click()
    await expect(emergencyDialog.getByText('Help is on the way')).toBeVisible()
    await emergencyContext.close()
  })

  test('name and description are optional -- submitting with both blank still works exactly as before', async ({
    page,
  }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Restrooms', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(dialog.getByText('Question sent')).toBeVisible()
  })

  test('description over the character limit cannot be typed/submitted', async ({ page }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    const description = dialog.getByPlaceholder("What's going on? (optional)")
    await description.fill('x'.repeat(600))
    await expect(description).toHaveValue('x'.repeat(500))
  })

  test('a submitted question with name and description populates correctly on the Staff Page', async ({
    page,
    context,
  }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByPlaceholder('Your name (optional)').fill('Jane Guest')
    await dialog.getByPlaceholder("What's going on? (optional)").fill('The water fountain is broken.')
    await dialog.getByRole('button', { name: 'General Store', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(dialog.getByText('Question sent')).toBeVisible()

    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()

    const row = staffPage.locator('.staff-request-row', { hasText: 'General Store' })
    await expect(row).toBeVisible()
    await expect(row.getByText('from Jane Guest')).toBeVisible()
    await expect(row.getByText('The water fountain is broken.')).toBeVisible()
  })

  test('a submitted question carries the chosen location through to the staff view', async ({ page, context }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Admin Offices', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(dialog.getByText('Question sent')).toBeVisible()

    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()

    const row = staffPage.locator('.staff-request-row', { hasText: 'Admin Offices' })
    await expect(row).toBeVisible()
    await expect(row.getByText('Question', { exact: true })).toBeVisible()
    await expect(row.getByText('Open', { exact: true })).toBeVisible()
  })

  test('staff view reflects a new emergency request and each status change, via Refresh', async ({
    page,
    context,
  }) => {
    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()
    await expect(staffPage.locator('.staff-request-row', { hasText: 'Party Tents' })).toHaveCount(0)

    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I need help now' }).click()
    await dialog.getByRole('button', { name: 'Party Tents', exact: true }).click()
    await expect(dialog.getByText('Help is on the way')).toBeVisible()

    await staffPage.getByRole('button', { name: 'Refresh' }).click()
    const row = staffPage.locator('.staff-request-row', { hasText: 'Party Tents' })
    await expect(row).toBeVisible()
    await expect(row).toHaveClass(/staff-request-emergency/)
    await expect(row.getByText('Emergency', { exact: true })).toBeVisible()
    await expect(row.getByText('Open', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(row.getByText('Acknowledged', { exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)

    await row.getByRole('button', { name: 'Mark Resolved' }).click()
    // Resolved requests drop off the default (open + acknowledged) staff list.
    await expect(staffPage.locator('.staff-request-row', { hasText: 'Party Tents' })).toHaveCount(0)

    await staffPage.getByRole('button', { name: 'Refresh' }).click()
    await expect(staffPage.locator('.staff-request-row', { hasText: 'Party Tents' })).toHaveCount(0)
  })

  test('a session with an active request sees the active view (status + Cancel) instead of the normal menu on reopen', async ({
    page,
  }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Animal Stage', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(dialog.getByText('Question sent')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()

    const reopened = await openContactStaff(page)
    // The normal menu is gone -- can't start a second simultaneous request
    // while this one is still active.
    await expect(reopened.getByRole('button', { name: 'I have a question' })).toHaveCount(0)
    await expect(reopened.getByRole('button', { name: 'I need help now' })).toHaveCount(0)
    await expect(reopened.getByText('Open', { exact: true })).toBeVisible()
    await expect(reopened.getByRole('button', { name: 'Cancel Request' })).toBeVisible()
  })

  test('Cancel Request clears the active state and lets the guest submit a fresh request afterward', async ({
    page,
  }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Goats', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await dialog.getByRole('button', { name: 'Close' }).click()

    const reopened = await openContactStaff(page)
    await reopened.getByRole('button', { name: 'Cancel Request' }).click()
    await expect(reopened.getByRole('button', { name: 'I have a question' })).toBeVisible()
    await expect(reopened.getByRole('button', { name: 'I need help now' })).toBeVisible()

    // A genuinely fresh submission works -- not blocked by the now-cancelled
    // request.
    await reopened.getByRole('button', { name: 'I have a question' }).click()
    await reopened.getByRole('button', { name: 'Small Animals', exact: true }).click()
    await reopened.getByRole('button', { name: 'Submit Question' }).click()
    await expect(reopened.getByText('Question sent')).toBeVisible()
  })

  test('cancelling an already-resolved request is rejected (409), and the guest can submit fresh once resolved', async ({
    page,
    context,
    request,
  }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Fort Slide', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await dialog.getByRole('button', { name: 'Close' }).click()

    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()
    const row = staffPage.locator('.staff-request-row', { hasText: 'Fort Slide' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Mark Resolved' }).click()
    await expect(staffPage.locator('.staff-request-row', { hasText: 'Fort Slide' })).toHaveCount(0)

    // Direct API cancel attempt after resolution -- there's no guest-facing
    // Cancel button left to click once resolution has cleared the modal's
    // own active-request view, so this exercises the backend guard directly.
    const deviceToken = await page.evaluate(() => localStorage.getItem('cap-device-session-id'))
    const cancelRes = await request.post(`${API}/staff-requests/mine/cancel`, withSession(deviceToken!))
    expect(cancelRes.status()).toBe(409)

    // Resolved clears the way for a genuinely new submission.
    const reopened = await openContactStaff(page)
    await expect(reopened.getByRole('button', { name: 'I have a question' })).toBeVisible()
  })

  test('staff Acknowledge produces a proactive toast and updates the guest nav badge', async ({ page, context }) => {
    const dialog = await openContactStaff(page)
    await dialog.getByRole('button', { name: 'I have a question' }).click()
    await dialog.getByRole('button', { name: 'Chicken Bowl', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit Question' }).click()
    await dialog.getByRole('button', { name: 'Close' }).click()

    await openNavMenu(page)
    await expect(page.getByRole('button', { name: 'Contact Staff — request open' })).toBeVisible()

    const staffPage = await context.newPage()
    await loginAsStaff(staffPage)
    await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()
    const row = staffPage.locator('.staff-request-row', { hasText: 'Chicken Bowl' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(row.getByText('Acknowledged', { exact: true })).toBeVisible()

    // Force the guest-side poll tick instead of sleeping past the real 12s
    // interval -- same reasoning as this file's header comment re: using
    // StaffPage's Refresh button instead of sleeping out ITS poll.
    await page.evaluate(() => window.__capReloadContactStatus?.())
    await expect(page.getByText('\u{1F44B} Staff has seen your request and is on the way!')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Contact Staff — request acknowledged' })).toBeVisible()
  })

  test('two independent device sessions have completely independent request/status/cancel state', async ({
    request,
  }) => {
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()

    const createA = await request.post(`${API}/staff-requests`, {
      ...withSession(tokenA),
      data: { type: 'question', location_node_id: null, name: null, description: null },
    })
    expect(createA.ok()).toBe(true)

    // B has submitted nothing -- its own "mine" lookup must stay null even
    // though A (a completely different session) has an active request.
    const mineBBeforeAny = await request.get(`${API}/staff-requests/mine`, withSession(tokenB))
    expect(await mineBBeforeAny.json()).toBeNull()

    const mineA = await request.get(`${API}/staff-requests/mine`, withSession(tokenA))
    const mineABody = await mineA.json()
    expect(mineABody.status).toBe('open')

    // Acknowledge A's request as staff.
    const staffToken = await apiStaffLogin(request)
    const ackRes = await request.post(`${API}/staff-requests/${mineABody.id}/acknowledge`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
    expect(ackRes.ok()).toBe(true)

    // B still sees no active request of its own -- A's status change didn't
    // leak across sessions.
    const mineBAfterAck = await request.get(`${API}/staff-requests/mine`, withSession(tokenB))
    expect(await mineBAfterAck.json()).toBeNull()

    // B can submit its own request completely independently of A's.
    const createB = await request.post(`${API}/staff-requests`, {
      ...withSession(tokenB),
      data: { type: 'emergency', location_node_id: null, name: null, description: null },
    })
    expect(createB.ok()).toBe(true)
    const mineB = await (await request.get(`${API}/staff-requests/mine`, withSession(tokenB))).json()
    expect(mineB.status).toBe('open')

    // Cancelling B's request must not touch A's (still acknowledged, not
    // cancelled).
    const cancelB = await request.post(`${API}/staff-requests/mine/cancel`, withSession(tokenB))
    expect(cancelB.ok()).toBe(true)
    const mineAAfterBCancel = await (await request.get(`${API}/staff-requests/mine`, withSession(tokenA))).json()
    expect(mineAAfterBCancel.status).toBe('acknowledged')
  })
})
