import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import { expectControlReachable, expectNoHorizontalOverflow } from './layoutHelper'

// Walks every Staff tab (plus the standalone Visit Heatmap page) at phone
// widths and checks the page never scrolls or clips sideways and every
// visible button/tab/link-button is inside the viewport, unobstructed and
// at least ~44px tall. Uses whatever dev data is already there plus a
// staff login -- creates nothing.

const TABS = ['Photo Queue', 'Contact Requests', 'Announcements', 'Attractions', 'Animal Photos', 'Analytics', 'QR Codes']

const WIDTHS: [number, number][] = [
  [360, 740],
  [390, 844],
]

async function expectScreenFits(page: Page, screen: string) {
  await expectNoHorizontalOverflow(page)
  const controls = page.locator(
    '.staff-page button:visible, .staff-page [role="tab"]:visible, .staff-page a.btn:visible, .staff-page select:visible',
  )
  const count = await controls.count()
  expect(count, `${screen}: no controls found`).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    await expectControlReachable(controls.nth(i))
  }
}

for (const [width, height] of WIDTHS) {
  test(`every Staff screen fits a ${width}px phone`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height })
    // A stray confirm() (e.g. Delete) must never go through on real data.
    page.on('dialog', (dialog) => dialog.dismiss())
    await loginAsStaff(page)

    for (const tab of TABS) {
      await test.step(tab, async () => {
        await page.getByRole('tab', { name: tab }).click()
        await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
        // Let the tab's list finish loading so rows are measured too.
        await expect(page.locator('.staff-page-content').getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 })
        await expectScreenFits(page, tab)
      })
    }

    await test.step('Analytics custom date range', async () => {
      await page.getByRole('tab', { name: 'Analytics' }).click()
      await page.getByRole('button', { name: 'Custom' }).click()
      await expectScreenFits(page, 'Analytics (custom range)')
      const dates = page.locator('.staff-analytics-custom-range input[type="date"]')
      for (const date of await dates.all()) await expectControlReachable(date)
    })

    await test.step('Visit Heatmap', async () => {
      await page.getByRole('link', { name: 'Heatmap', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Visit Heatmap' })).toBeVisible()
      await expect(page.getByText('Loading heatmap…')).toHaveCount(0, { timeout: 15_000 })
      await expectScreenFits(page, 'Visit Heatmap')
    })
  })
}
