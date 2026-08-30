import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff, readStaffPassword } from './staffAuthHelper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// Covers the /staff auth gate + the Photo Queue/Contact Requests page built
// on top of the pre-existing (previously unauthenticated) StaffRequestsScreen.
// Favorite Photo and Contact Staff's own submission flows are already
// covered by favorite-photo.spec.ts and contact-staff.spec.ts -- this file
// focuses on what's new: login, the nav entry point, Approve/Reject/Delete,
// and emergency-first ordering + the resolved filter.

// Contact Staff / Favorite Photo both live inside the guest nav's dropdown
// panel, which starts closed on every fresh page load -- open it first.
async function openContactStaff(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Contact Staff' }).click()
  return page.getByRole('dialog')
}

async function openFavoritePhoto(page: Page) {
  await page.getByRole('button', { name: 'Open menu' }).click()
  // The tab list uses role="menuitemradio" (NavMenu.tsx), not the button
  // tag's implicit "button" role.
  await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
}

async function submitPhoto(page: Page, label: string) {
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(label)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()
}

test.describe('Staff Page auth', () => {
  test('wrong password is rejected; correct password logs in and persists across reload; no session shows the login screen', async ({
    page,
  }) => {
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: 'Staff Login' })).toBeVisible()

    await page.getByLabel('Password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByText('Incorrect password.')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Photo Queue' })).toHaveCount(0)

    await loginAsStaff(page)
    await expect(page.getByRole('tab', { name: 'Photo Queue' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('tab', { name: 'Photo Queue' })).toBeVisible()
  })

  test('a fresh browsing context with no stored session sees the login screen, not staff data', async ({
    browser,
  }) => {
    const freshContext = await browser.newContext()
    const freshPage = await freshContext.newPage()
    await freshPage.goto('/staff')
    await expect(freshPage.getByRole('heading', { name: 'Staff Login' })).toBeVisible()
    await expect(freshPage.getByRole('tab', { name: 'Photo Queue' })).toHaveCount(0)
    await freshContext.close()
  })

  test('mutation and staff-only list endpoints reject requests with no Authorization header', async ({ page }) => {
    // require_staff runs before the route body, so a syntactically valid but
    // nonexistent id still proves the auth gate (401), not a 404 lookup miss.
    await page.goto('/')
    const statuses = await page.evaluate(async () => {
      const fakeId = crypto.randomUUID()
      const responses = await Promise.all([
        fetch(`http://localhost:8000/photos/${fakeId}/shortlist`, { method: 'POST' }),
        fetch(`http://localhost:8000/photos/${fakeId}/reject`, { method: 'POST' }),
        fetch(`http://localhost:8000/photos/${fakeId}`, { method: 'DELETE' }),
        fetch(`http://localhost:8000/staff-requests/${fakeId}/resolve`, { method: 'POST' }),
        fetch(`http://localhost:8000/staff-requests/${fakeId}/acknowledge`, { method: 'POST' }),
        fetch('http://localhost:8000/photos/pending'),
        fetch('http://localhost:8000/staff-requests'),
      ])
      return responses.map((r) => r.status)
    })
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401])
  })
})

test('the Staff nav link is visible in the guest nav menu and navigates to /staff', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Staff', exact: true }).click()
  await expect(page).toHaveURL(/\/staff$/)
})

test('Approve promotes a photo into the gallery; Reject and Delete both remove it from the queue, but only Delete removes the row entirely', async ({
  page,
  context,
}) => {
  const approveLabel = `E2E StaffPage Approve ${Date.now()}`
  const rejectLabel = `E2E StaffPage Reject ${Date.now()}`
  const deleteLabel = `E2E StaffPage Delete ${Date.now()}`

  await page.goto('/')
  await openFavoritePhoto(page)
  await submitPhoto(page, approveLabel)
  await submitPhoto(page, rejectLabel)
  await submitPhoto(page, deleteLabel)

  const staffPage = await context.newPage()
  staffPage.on('dialog', (dialog) => dialog.accept())
  await loginAsStaff(staffPage)

  const approveRow = staffPage.locator('.staff-photo-row', { hasText: approveLabel })
  await expect(approveRow).toBeVisible()
  await approveRow.getByRole('button', { name: 'Approve' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: approveLabel })).toHaveCount(0)

  const rejectRow = staffPage.locator('.staff-photo-row', { hasText: rejectLabel })
  await expect(rejectRow).toBeVisible()
  await rejectRow.getByRole('button', { name: 'Reject' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: rejectLabel })).toHaveCount(0)

  const deleteRow = staffPage.locator('.staff-photo-row', { hasText: deleteLabel })
  await expect(deleteRow).toBeVisible()
  const deleteId = await deleteRow.getAttribute('data-submission-id')
  await deleteRow.getByRole('button', { name: 'Delete' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: deleteLabel })).toHaveCount(0)

  // Approved photo shows up in the guest gallery; rejected/deleted never do.
  await page.goto('/')
  await openFavoritePhoto(page)
  await expect(page.locator('.photo-card', { hasText: approveLabel })).toBeVisible()
  await expect(page.locator('.photo-card', { hasText: rejectLabel })).toHaveCount(0)
  await expect(page.locator('.photo-card', { hasText: deleteLabel })).toHaveCount(0)

  // Delete hard-removes the row -- acting on the same id afterwards finds
  // nothing at all (404), the actual proof it's gone rather than re-flagged
  // like Reject (which keeps the row, just excluded from the queue).
  const deleteAgainStatus = await staffPage.evaluate(async (id) => {
    const token = localStorage.getItem('cap-staff-session-token')
    const res = await fetch(`http://localhost:8000/photos/${id}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.status
  }, deleteId)
  expect(deleteAgainStatus).toBe(404)
})

test('an emergency request sorts above an earlier question; Mark Resolved removes it from the default view; Show Resolved brings it back', async ({
  page,
  context,
  browser,
}) => {
  const questionDialog = await openContactStaff(page)
  await questionDialog.getByRole('button', { name: 'I have a question' }).click()
  // Not "Critter Cafe" -- staff-analytics.spec.ts also submits a Critter
  // Cafe Contact Staff question as its own fixture data and runs earlier in
  // file order, and this test's assertions below need an exact single-row
  // match by location name.
  await questionDialog.getByRole('button', { name: 'Playground', exact: true }).click()
  await questionDialog.getByRole('button', { name: 'Submit Question' }).click()
  await expect(questionDialog.getByText('Question sent')).toBeVisible()
  await questionDialog.getByRole('button', { name: 'Close' }).click()

  // Separate browser context (its own device session) for the emergency
  // submission -- `page`'s session already has an active request from the
  // question above, and reopening Contact Staff on a session with an active
  // request now shows that request's status instead of the normal menu
  // (Per-Device Sessions Contact Staff feature), which isn't what this test
  // is about (it only cares about staff-side sorting/resolve behavior across
  // two independent requests).
  const emergencyContext = await browser.newContext()
  const emergencyPage = await emergencyContext.newPage()
  const emergencyDialog = await openContactStaff(emergencyPage)
  await emergencyDialog.getByRole('button', { name: 'I need help now' }).click()
  await emergencyDialog.getByRole('button', { name: 'Sugar Shack', exact: true }).click()
  await expect(emergencyDialog.getByText('Help is on the way')).toBeVisible()

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()

  // The request list is fetched once on mount (StaffPage.tsx's reload()),
  // independent of which tab is selected -- that fetch can still be in
  // flight right after loginAsStaff resolves (which only waits for the
  // Photo Queue tab to render, not for the requests fetch to complete).
  // allTextContents() below is a one-shot DOM read with no auto-retry, so
  // wait for both rows to actually be visible first or this flakes under
  // load.
  await expect(staffPage.locator('.staff-request-row', { hasText: 'Sugar Shack' })).toBeVisible()
  await expect(staffPage.locator('.staff-request-row', { hasText: 'Playground' })).toBeVisible()

  const rowTexts = await staffPage.locator('.staff-request-row').allTextContents()
  const emergencyIndex = rowTexts.findIndex((t) => t.includes('Sugar Shack'))
  const questionIndex = rowTexts.findIndex((t) => t.includes('Playground'))
  expect(emergencyIndex).toBeGreaterThanOrEqual(0)
  expect(questionIndex).toBeGreaterThanOrEqual(0)
  expect(emergencyIndex).toBeLessThan(questionIndex)

  const emergencyRow = staffPage.locator('.staff-request-row', { hasText: 'Sugar Shack' })
  await emergencyRow.getByRole('button', { name: 'Mark Resolved' }).click()
  await expect(staffPage.locator('.staff-request-row', { hasText: 'Sugar Shack' })).toHaveCount(0)

  await staffPage.getByRole('checkbox', { name: 'Show Resolved' }).check()
  const resolvedRow = staffPage.locator('.staff-request-row', { hasText: 'Sugar Shack' })
  await expect(resolvedRow).toBeVisible()
  await expect(resolvedRow.getByText('Resolved', { exact: true })).toBeVisible()

  await emergencyContext.close()
})

test('a staff session with no display name yet is prompted once; the name then attributes Acknowledge/Resolve and can be changed', async ({
  page,
  browser,
}) => {
  const dialog = await openContactStaff(page)
  await dialog.getByRole('button', { name: 'I have a question' }).click()
  await dialog.getByRole('button', { name: 'Rope Maze', exact: true }).click()
  await dialog.getByRole('button', { name: 'Submit Question' }).click()
  await expect(dialog.getByText('Question sent')).toBeVisible()

  // A genuinely fresh browser context -- no staff session, no staff display
  // name stored yet -- logged in by hand (not loginAsStaff, which seeds a
  // name precisely so this prompt doesn't show for every other spec).
  const staffContext = await browser.newContext()
  const staffPage = await staffContext.newPage()
  await staffPage.goto('/staff')
  await staffPage.getByLabel('Password').fill(readStaffPassword())
  await staffPage.getByRole('button', { name: 'Log In' }).click()

  const namePrompt = staffPage.getByRole('heading', { name: /What.s your name\?/ })
  await expect(namePrompt).toBeVisible()
  await staffPage.getByLabel('Your name', { exact: true }).fill('Priya')
  await staffPage.getByRole('button', { name: 'Save' }).click()
  await expect(namePrompt).toHaveCount(0)

  // Persists across reload, and is visible in the header badge.
  await staffPage.reload()
  await expect(staffPage.getByRole('tab', { name: 'Photo Queue' })).toBeVisible()
  await expect(namePrompt).toHaveCount(0)
  await expect(staffPage.locator('.staff-name-badge-label')).toHaveText('Priya')

  await staffPage.getByRole('tab', { name: 'Contact Requests' }).click()
  const row = staffPage.locator('.staff-request-row', { hasText: 'Rope Maze' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(row.getByText('Acknowledged by Priya')).toBeVisible()

  await row.getByRole('button', { name: 'Mark Resolved' }).click()
  // Wait for the resolve's own reload to land (row drops off the default
  // open+acknowledged view) before toggling Show Resolved -- otherwise that
  // toggle's reload (include_closed=true) can race the resolve's own reload
  // (include_closed=false) and lose, same gotcha the emergency-sort test
  // above avoids the same way.
  await expect(staffPage.locator('.staff-request-row', { hasText: 'Rope Maze' })).toHaveCount(0)
  await staffPage.getByRole('checkbox', { name: 'Show Resolved' }).check()
  const resolvedRow = staffPage.locator('.staff-request-row', { hasText: 'Rope Maze' })
  await expect(resolvedRow.getByText('Resolved by Priya')).toBeVisible()

  // The "Change" control reopens the prompt pre-filled with the current
  // name, and saving it updates the badge going forward.
  await staffPage.getByRole('button', { name: 'Change' }).click()
  const nameInput = staffPage.getByLabel('Your name', { exact: true })
  await expect(nameInput).toHaveValue('Priya')
  await nameInput.fill('Priya B')
  await staffPage.getByRole('button', { name: 'Save' }).click()
  await expect(staffPage.locator('.staff-name-badge-label')).toHaveText('Priya B')

  await staffContext.close()
})
