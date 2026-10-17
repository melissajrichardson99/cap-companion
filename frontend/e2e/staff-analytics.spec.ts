import { test, expect } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import { openNavMenu } from './navMenuHelper'

// Covers the new Analytics dashboard (Staff Page Analytics feature): the
// sidebar reorg (Part 2) and the dashboard itself (Part 3). Contact Staff's
// own submission flow is already covered by contact-staff.spec.ts and
// staff-page.spec.ts -- this file drives one cheap real submission purely as
// fixture data, so at least one Analytics metric is guaranteed non-zero.

async function submitContactStaffQuestion(page: import('@playwright/test').Page) {
  await page.goto('/')
  await openNavMenu(page)
  await page.getByRole('button', { name: 'Contact Staff' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'I have a question' }).click()
  await dialog.getByRole('button', { name: 'Critter Cafe', exact: true }).click()
  await dialog.getByRole('button', { name: 'Submit Question' }).click()
  await expect(dialog.getByText('Question sent')).toBeVisible()
}

test('the sidebar shows exactly the real staff features plus Analytics and QR Codes -- nothing from the mockup\'s excluded set', async ({ page }) => {
  await loginAsStaff(page)
  // Only the default (Photo Queue) tab body is mounted at this point, so
  // this only matches the 7 sidebar items -- not the Animal Photos tab's own
  // internal role="tab" animal picker, which isn't in the DOM yet.
  const labels = (await page.getByRole('tab').allTextContents()).map((t) => t.replace(/\d+$/, '').trim())
  expect(labels.sort()).toEqual(
    ['Analytics', 'Animal Photos', 'Announcements', 'Attractions', 'Contact Requests', 'Photo Queue', 'QR Codes'].sort(),
  )
  for (const excluded of ['Dashboard', 'Reports', 'Settings', 'Quick Actions', 'Food Trucks']) {
    await expect(page.getByRole('tab', { name: excluded })).toHaveCount(0)
  }
})

test('Analytics loads via the sidebar, reflects a real Contact Staff request, and the date range filter actually changes the numbers', async ({
  page,
  context,
}) => {
  await submitContactStaffQuestion(page)

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await staffPage.getByRole('tab', { name: 'Analytics' }).click()

  // 7D safely includes the request just submitted above.
  await staffPage.getByRole('button', { name: '7D' }).click()

  const totalUsersValue = staffPage.locator('.staff-analytics-stat-card', { hasText: 'Total App Users' }).locator('.staff-analytics-stat-value')
  // Default wait: the summary is one SQL function call (migration 044),
  // well under a second however many sessions the dev DB has accumulated.
  await expect(totalUsersValue).toBeVisible()
  const totalUsersText = await totalUsersValue.textContent()
  expect(totalUsersText).not.toBeNull()
  expect(Number.isNaN(Number(totalUsersText))).toBe(false)
  expect(Number(totalUsersText)).toBeGreaterThanOrEqual(1)

  const staffOpsValue = staffPage
    .locator('.staff-analytics-stat-card', { hasText: 'Total Contact Staff Requests' })
    .locator('.staff-analytics-stat-value')
  const staffOpsText = await staffOpsValue.textContent()
  expect(Number.isNaN(Number(staffOpsText))).toBe(false)
  expect(Number(staffOpsText)).toBeGreaterThanOrEqual(1)

  // A custom range placed entirely before any seeded/e2e activity should
  // render cleanly (no error state) and show zero users -- proves the
  // date-range filter is actually wired up, not just decorative.
  await staffPage.getByRole('button', { name: 'Custom' }).click()
  await staffPage.getByLabel('Range start').fill('2020-01-01')
  await staffPage.getByLabel('Range end').fill('2020-01-02')

  await expect(totalUsersValue).toHaveText('0')
  await expect(staffPage.getByText(/Couldn't load analytics/)).toHaveCount(0)
})

test('mutation-free Analytics endpoint rejects requests with no staff Authorization header', async ({ page }) => {
  await page.goto('/')
  const status = await page.evaluate(async () => {
    const res = await fetch('http://localhost:8000/analytics/summary?start=2020-01-01&end=2020-01-02')
    return res.status
  })
  expect(status).toBe(401)
})
