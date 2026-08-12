import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'

// Covers Contact Staff (Plan.md 2.10, migration 010_contact_staff.sql): both
// guest-facing flows (question / emergency) submit with the right location
// attached, the emergency path is genuinely fewer taps than the question
// path, and the staff view (/staff) reflects new requests and status
// changes. Exercised through the staff view's manual Refresh button rather
// than sleeping out the real ~12s poll interval -- Refresh calls the exact
// same reload() the poll timer does, so it covers the same code path.

async function openContactStaff(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
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

  test('emergency path reaches submission in fewer taps than the question path', async ({ page }) => {
    // Question path: menu -> "I have a question" -> pick location -> "Submit
    // Question" -- 3 taps before a request exists.
    const questionDialog = await openContactStaff(page)
    await questionDialog.getByRole('button', { name: 'I have a question' }).click()
    await questionDialog.getByRole('button', { name: 'Ticket Booth', exact: true }).click()
    await expect(questionDialog.getByText('Question sent')).toHaveCount(0) // not submitted yet after 2 taps
    await questionDialog.getByRole('button', { name: 'Submit Question' }).click()
    await expect(questionDialog.getByText('Question sent')).toBeVisible() // submitted after a 3rd tap
    await questionDialog.getByRole('button', { name: 'Close' }).click()

    // Emergency path: menu -> "I need help now" -> pick location -- already
    // submitted after only 2 taps, one fewer than the question path.
    const emergencyDialog = await openContactStaff(page)
    await emergencyDialog.getByRole('button', { name: 'I need help now' }).click()
    await emergencyDialog.getByRole('button', { name: 'Ticket Booth', exact: true }).click()
    await expect(emergencyDialog.getByText('Help is on the way')).toBeVisible()
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
})
