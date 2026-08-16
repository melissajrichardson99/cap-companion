import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// Covers Staff Page management of already-shortlisted (live, guest-facing)
// photos -- distinct from staff-page.spec.ts, which only covers the pending
// queue (Approve/Reject/Delete on pending_review rows). This exercises the
// Shortlisted section's individual Remove and bulk Clear All.

async function openFavoritePhoto(page: Page) {
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
}

async function submitAndShortlist(guestPage: Page, staffPage: Page, label: string) {
  await guestPage.goto('/')
  await openFavoritePhoto(guestPage)
  await guestPage.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await guestPage.getByPlaceholder('Your name (optional)').fill(label)
  await guestPage.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(guestPage.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()

  // The Staff Page only polls every 12s (StaffPage.tsx POLL_INTERVAL_MS) --
  // force an immediate refresh rather than waiting out the interval.
  await staffPage.getByRole('button', { name: 'Refresh' }).click()

  const pendingRow = staffPage.locator('.staff-photo-row', { hasText: label })
  await expect(pendingRow).toBeVisible()
  await pendingRow.getByRole('button', { name: 'Approve' }).click()
  await expect(staffPage.locator('.staff-shortlisted-row', { hasText: label })).toBeVisible()
}

test('shortlisted photos show on the Staff Page with vote counts, and individual Remove deletes just that one', async ({
  page,
  context,
}) => {
  const removeLabel = `E2E Shortlist Remove ${Date.now()}`
  const keepLabel = `E2E Shortlist Keep ${Date.now()}`

  const staffPage = await context.newPage()
  staffPage.on('dialog', (dialog) => dialog.accept())
  await loginAsStaff(staffPage)

  await submitAndShortlist(page, staffPage, removeLabel)
  await submitAndShortlist(page, staffPage, keepLabel)

  // Fresh vote count on a newly shortlisted photo.
  const removeRow = staffPage.locator('.staff-shortlisted-row', { hasText: removeLabel })
  await expect(removeRow.locator('.staff-photo-vote-count')).toHaveText('0 votes')

  // Guest gallery has both before removal.
  await page.goto('/')
  await openFavoritePhoto(page)
  await expect(page.locator('.photo-card', { hasText: removeLabel })).toBeVisible()
  await expect(page.locator('.photo-card', { hasText: keepLabel })).toBeVisible()

  const removeId = await removeRow.getAttribute('data-submission-id')
  await removeRow.getByRole('button', { name: 'Remove' }).click()
  await expect(staffPage.locator('.staff-shortlisted-row', { hasText: removeLabel })).toHaveCount(0)
  await expect(staffPage.locator('.staff-shortlisted-row', { hasText: keepLabel })).toBeVisible()

  // Gone from the guest gallery too; the other shortlisted photo is untouched.
  await page.goto('/')
  await openFavoritePhoto(page)
  await expect(page.locator('.photo-card', { hasText: removeLabel })).toHaveCount(0)
  await expect(page.locator('.photo-card', { hasText: keepLabel })).toBeVisible()

  // Hard delete -- the row is gone entirely, not just excluded from the gallery.
  const reShortlistStatus = await staffPage.evaluate(async (id) => {
    const token = localStorage.getItem('cap-staff-session-token')
    const res = await fetch(`http://localhost:8000/photos/${id}/shortlist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.status
  }, removeId)
  expect(reShortlistStatus).toBe(404)

  // Clean up the kept photo so it doesn't linger as permanent shortlisted
  // state for other specs/runs (this DB persists across test files/runs --
  // there's no per-test reset, only the whole-run one in global-setup).
  await staffPage.locator('.staff-shortlisted-row', { hasText: keepLabel }).getByRole('button', { name: 'Remove' }).click()
})

test('Clear All removes every shortlisted photo but leaves pending_review photos untouched, and requires a count-confirming dialog', async ({
  page,
  context,
}) => {
  const shortlistLabelA = `E2E ClearAll A ${Date.now()}`
  const shortlistLabelB = `E2E ClearAll B ${Date.now()}`
  const pendingLabel = `E2E ClearAll Pending ${Date.now()}`

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)

  await submitAndShortlist(page, staffPage, shortlistLabelA)
  await submitAndShortlist(page, staffPage, shortlistLabelB)

  // Leave a third photo pending (not approved) to prove Clear All doesn't touch it.
  await page.goto('/')
  await openFavoritePhoto(page)
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(pendingLabel)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()
  await staffPage.getByRole('button', { name: 'Refresh' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: pendingLabel })).toBeVisible()

  // Read the live total off the button rather than assuming exactly these 2:
  // other e2e spec files (e.g. favorite-photo.spec.ts) also shortlist photos
  // and don't clean up after themselves, so this DB can carry extra
  // shortlisted rows left over from earlier tests in the same run.
  const clearButton = staffPage.getByRole('button', { name: /Clear All \(\d+\)/ })
  const totalCount = Number((await clearButton.textContent())?.match(/\((\d+)\)/)?.[1])
  expect(totalCount).toBeGreaterThanOrEqual(2)

  await clearButton.click()
  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Ticket requirement: the confirmation must state how many photos will be
  // removed, not just a generic "are you sure".
  await expect(dialog.getByText(/permanently removes all/i)).toContainText(String(totalCount))
  await dialog.getByRole('button', { name: new RegExp(`Remove All ${totalCount} Photos`) }).click()

  await expect(staffPage.locator('.staff-shortlisted-row')).toHaveCount(0)
  await expect(staffPage.getByText('No photos are currently live in the voting gallery.')).toBeVisible()
  // Pending row survived the bulk clear -- proves the delete was scoped to
  // status = shortlisted, not an unscoped wipe of the whole table.
  await expect(staffPage.locator('.staff-photo-row', { hasText: pendingLabel })).toBeVisible()

  await page.goto('/')
  await openFavoritePhoto(page)
  await expect(page.locator('.photo-card')).toHaveCount(0)
})

test('shortlisted-photo staff endpoints reject requests with no Authorization header', async ({ page }) => {
  await page.goto('/')
  const statuses = await page.evaluate(async () => {
    const responses = await Promise.all([
      fetch('http://localhost:8000/photos/shortlisted'),
      fetch('http://localhost:8000/photos/shortlisted', { method: 'DELETE' }),
    ])
    return responses.map((r) => r.status)
  })
  expect(statuses).toEqual([401, 401])
})
