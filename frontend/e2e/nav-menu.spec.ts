import { test, expect, type Page } from '@playwright/test'

// Covers the guest nav dropdown's open/close mechanics (NavMenu.tsx): the
// hamburger toggle, the explicit close-on-toggle-click behavior, clicking a
// nav link inside the open panel, and (this file's reason for existing)
// clicking/tapping outside the open panel to dismiss it without picking a
// tab. See cap-companion-nav-menu-e2e-regression memory for the closed-by-
// default-on-every-load background.

function toggleBtn(page: Page) {
  return page.getByRole('button', { name: /(Open|Close) menu/ })
}

function panel(page: Page) {
  return page.locator('.nav-menu-panel')
}

async function expectOpen(page: Page) {
  await expect(panel(page)).toHaveClass(/nav-menu-panel-open/)
}

async function expectClosed(page: Page) {
  await expect(panel(page)).not.toHaveClass(/nav-menu-panel-open/)
}

test.describe('Nav menu dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('toggle button opens and closes the menu on its own', async ({ page }) => {
    await toggleBtn(page).click()
    await expectOpen(page)

    // The exact bug class called out for this fix: an outside-click listener
    // that fires on the same click that opened the menu and immediately
    // re-closes it. Confirm the menu is still open right after opening
    // (nothing async closes it a tick later).
    await page.waitForTimeout(150)
    await expectOpen(page)

    await toggleBtn(page).click()
    await expectClosed(page)
  })

  test('clicking outside the open panel closes it (mouse)', async ({ page }) => {
    await toggleBtn(page).click()
    await expectOpen(page)

    // Top-left corner of the viewport: outside both the toggle (top-right)
    // and the panel (anchored under the toggle).
    await page.mouse.click(10, 10)
    await expectClosed(page)
  })

  test('clicking a nav link inside the open panel still navigates and closes the menu', async ({ page }) => {
    await toggleBtn(page).click()
    await expectOpen(page)

    await page.getByRole('menuitemradio', { name: 'Map' }).click()

    await expect(page.getByRole('heading', { name: 'Park Map' })).toBeVisible()
    await expectClosed(page)
  })

  test('clicking inside the panel on a non-interactive area does not close it', async ({ page }) => {
    await toggleBtn(page).click()
    await expectOpen(page)

    await page.locator('.nav-menu-panel-inner').click({ position: { x: 5, y: 5 } })
    await expectOpen(page)
  })

})

test.describe('Nav menu dropdown (mobile / touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('tapping outside the open panel closes it, tapping the toggle still works', async ({ page }) => {
    await toggleBtn(page).tap()
    await expectOpen(page)
    // Same same-click-immediately-recloses guard as the desktop toggle test,
    // exercised via tap instead of click.
    await page.waitForTimeout(150)
    await expectOpen(page)

    await page.touchscreen.tap(10, 10)
    await expectClosed(page)

    await toggleBtn(page).tap()
    await expectOpen(page)
    await toggleBtn(page).tap()
    await expectClosed(page)
  })

  test('tapping a nav link inside the open panel still navigates and closes the menu', async ({ page }) => {
    await toggleBtn(page).tap()
    await expectOpen(page)

    await page.getByRole('menuitemradio', { name: 'Map' }).tap()

    await expect(page.getByRole('heading', { name: 'Park Map' })).toBeVisible()
    await expectClosed(page)
  })
})
