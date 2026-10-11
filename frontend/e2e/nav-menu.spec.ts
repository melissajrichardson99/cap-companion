import { test, expect, type Page } from '@playwright/test'
import { closeNavMenu, navPanel, openNavMenu } from './navMenuHelper'

// Covers the guest nav dropdown (NavMenu.tsx): open/close mechanics (the
// hamburger toggle opens it and hides while it's open; the panel's X,
// Escape and an outside click/tap close it and return focus to the toggle),
// the complete list of menu items in each section (so a page can't silently
// go missing), the pinned header/footer and scroll hints on a small screen,
// the top-bar scan button, and Reset Session's confirm step. See
// cap-companion-nav-menu-e2e-regression memory for the closed-by-default-on-
// every-load background.

function toggleBtn(page: Page) {
  return page.getByRole('button', { name: 'Open menu' })
}

async function expectOpen(page: Page) {
  await expect(navPanel(page)).toHaveClass(/nav-menu-panel-open/)
}

async function expectClosed(page: Page) {
  await expect(navPanel(page)).not.toHaveClass(/nav-menu-panel-open/)
}

// Every item the menu must offer, by section, in order. Route tiles are
// role="menuitemradio"; the rest are plain buttons. ACCOUNT stands in for
// the account tile, labelled "Save Your Progress" signed out and with the
// guest's email signed in.
const ACCOUNT = '<account>'
const EXPECTED_SECTIONS: { name: string; items: string[] }[] = [
  { name: 'Explore', items: ['Home', 'Map', 'Our Animals', 'Food Truck Menus'] },
  { name: 'Activities', items: ['Bingo Card', 'Puzzles', 'Scoring Sheets', 'Scavenger Hunt'] },
  { name: 'My Collection', items: ['Collectibles', 'Favorite Photo', 'Generate Passport', ACCOUNT] },
  { name: 'Help & Settings', items: ['FAQ', 'Privacy Policy', 'Staff', 'Reset Session'] },
]

async function expectCompleteMenu(page: Page, accountLabel: string) {
  const panel = navPanel(page)

  // Pinned header/footer controls.
  await expect(panel.getByRole('button', { name: 'Close menu' })).toBeInViewport()
  await expect(panel.getByRole('button', { name: 'Scan QR', exact: true })).toBeInViewport()
  await expect(panel.getByRole('button', { name: 'Contact Staff' })).toBeInViewport()

  for (const section of EXPECTED_SECTIONS) {
    const group = panel.getByRole('group', { name: section.name })
    const expected = section.items.map((item) => (item === ACCOUNT ? accountLabel : item))
    // The exact set and order -- an extra or missing item fails here.
    const actual = await group
      .locator('button')
      .evaluateAll((buttons) => buttons.map((b) => (b.textContent ?? '').trim()))
    expect(actual, `items in "${section.name}"`).toEqual(expected)
    // And each one is genuinely reachable: scrolled into view inside the
    // panel's scrolling middle, visible and clickable.
    for (const label of expected) {
      const item = group.locator('button', { hasText: label })
      await item.scrollIntoViewIfNeeded()
      await expect(item).toBeInViewport()
      await expect(item).toBeEnabled()
    }
  }
}

test.describe('Nav menu dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('toggle opens the menu and hides; the panel X closes it and focus returns to the toggle', async ({ page }) => {
    await toggleBtn(page).click()
    await expectOpen(page)

    // The exact bug class called out for the original fix: an outside-click
    // listener that fires on the same click that opened the menu and
    // immediately re-closes it. Confirm the menu is still open right after
    // opening (nothing async closes it a tick later).
    await page.waitForTimeout(150)
    await expectOpen(page)

    // The toggle hides while open (out of the accessibility tree too), and
    // focus moves to the panel's X.
    await expect(toggleBtn(page)).toBeHidden()
    await expect(navPanel(page).getByRole('button', { name: 'Close menu' })).toBeFocused()

    await closeNavMenu(page)
    await expect(toggleBtn(page)).toBeVisible()
    await expect(toggleBtn(page)).toBeFocused()
  })

  test('Escape closes the menu and returns focus to the toggle', async ({ page }) => {
    await openNavMenu(page)
    await page.keyboard.press('Escape')
    await expectClosed(page)
    await expect(toggleBtn(page)).toBeFocused()
  })

  test('clicking outside the open panel closes it (mouse)', async ({ page }) => {
    await openNavMenu(page)

    // Top-left corner of the viewport: outside the panel (anchored under
    // the header's right side).
    await page.mouse.click(10, 10)
    await expectClosed(page)
    await expect(toggleBtn(page)).toBeFocused()
  })

  test('clicking a nav link inside the open panel still navigates and closes the menu', async ({ page }) => {
    await openNavMenu(page)

    await page.getByRole('menuitemradio', { name: 'Map' }).click()

    await expect(page.getByRole('heading', { name: 'Park Map' })).toBeVisible()
    await expectClosed(page)
  })

  test('clicking inside the panel on a non-interactive area does not close it', async ({ page }) => {
    await openNavMenu(page)

    await page.locator('.nav-menu-panel-inner').click({ position: { x: 5, y: 5 } })
    await expectOpen(page)
  })

  test('the closed panel is out of the accessibility tree', async ({ page }) => {
    await expect(page.getByRole('menuitemradio', { name: 'Map' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveCount(0)
  })

  test('the active route is marked in the menu', async ({ page }) => {
    await page.goto('/bingo')
    await openNavMenu(page)
    await expect(page.getByRole('menuitemradio', { name: 'Bingo Card' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemradio', { name: 'Map' })).toHaveAttribute('aria-checked', 'false')
  })

  test('the top-bar scan button opens the same scan flow as the menu', async ({ page }) => {
    await page.goto('/map')
    await page.getByRole('button', { name: 'Open QR scanner' }).click()

    const modal = page.locator('.modal-panel')
    await expect(modal.getByText('Scan a Code')).toBeVisible()
    // Same resolution path as the menu's Scan QR -- a Scoring game slug
    // (stateless, unlike a Hunt character unlock) routes to that game.
    await modal.getByLabel("What's on the sign").fill('farm-toss')
    await modal.getByRole('button', { name: 'Go' }).click()
    await expect(page).toHaveURL(/\/scoring\/farm-toss$/)
  })

  test('Reset Session shows its confirm dialog and only resets after confirming', async ({ page }) => {
    let resetCalls = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/session/reset')) resetCalls++
    })

    await openNavMenu(page)
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reset Session' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    expect(resetCalls).toBe(0)

    await openNavMenu(page)
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const resetResponse = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().endsWith('/session/reset'),
    )
    await dialog.getByRole('button', { name: 'Reset Session' }).click()
    expect((await resetResponse).ok()).toBe(true)
    await expect(dialog).not.toBeVisible()
    expect(resetCalls).toBe(1)
  })
})

test.describe('Nav menu completeness', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('signed out: every expected item is present, in its section, and reachable', async ({ page }) => {
    await page.goto('/')
    await openNavMenu(page)
    await expectCompleteMenu(page, 'Save Your Progress')
  })

  test('signed in: the account tile shows the email and nothing else changes', async ({ page }) => {
    const email = `nav-${crypto.randomUUID()}@example.com`
    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill('correct horse battery staple')
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()

    await openNavMenu(page)
    await expectCompleteMenu(page, email)
  })
})

test.describe('Nav menu small screen: pinned header/footer and scroll hints', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('Scan QR and Contact Staff stay on screen with the middle scrolled to the bottom', async ({ page }) => {
    await page.goto('/map')
    await openNavMenu(page)
    const scroll = page.locator('.nav-menu-scroll')
    await scroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect(page.getByRole('button', { name: 'Reset Session' })).toBeInViewport()

    const panel = navPanel(page)
    await expect(panel.getByRole('button', { name: 'Scan QR', exact: true })).toBeInViewport()
    await expect(panel.getByRole('button', { name: 'Contact Staff' })).toBeInViewport()
    await expect(panel.getByRole('button', { name: 'Close menu' })).toBeInViewport()
  })

  test('the scroll hint shows while there is more below and clears at the bottom', async ({ page }) => {
    await page.goto('/map')
    await openNavMenu(page)
    const wrap = page.locator('.nav-menu-scroll-wrap')
    const fadeTop = page.locator('.nav-menu-fade-top')
    const fadeBottom = page.locator('.nav-menu-fade-bottom')
    const more = page.locator('.nav-menu-more')

    await expect(wrap).toHaveAttribute('data-can-scroll-down', 'true')
    await expect(wrap).toHaveAttribute('data-can-scroll-up', 'false')
    await expect(fadeBottom).toHaveCSS('opacity', '1')
    await expect(fadeTop).toHaveCSS('opacity', '0')
    await expect(more).toHaveClass(/nav-menu-more-visible/)
    // Decorative only -- never takes a tap.
    await expect(fadeBottom).toHaveCSS('pointer-events', 'none')
    await expect(more).toHaveCSS('pointer-events', 'none')

    // A real wheel scroll over the list, not a programmatic scrollTo.
    const box = await page.locator('.nav-menu-scroll').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(0, 3000)

    await expect(wrap).toHaveAttribute('data-can-scroll-down', 'false')
    await expect(wrap).toHaveAttribute('data-can-scroll-up', 'true')
    await expect(fadeBottom).toHaveCSS('opacity', '0')
    await expect(fadeTop).toHaveCSS('opacity', '1')
    await expect(more).not.toHaveClass(/nav-menu-more-visible/)
  })

  test('no scroll hint when everything fits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/map')
    await openNavMenu(page)
    const wrap = page.locator('.nav-menu-scroll-wrap')
    await expect(wrap).toHaveAttribute('data-can-scroll-down', 'false')
    await expect(wrap).toHaveAttribute('data-can-scroll-up', 'false')
    await expect(page.locator('.nav-menu-more')).not.toHaveClass(/nav-menu-more-visible/)
  })
})

test.describe('Nav menu dropdown (mobile / touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('tapping outside the open panel closes it, tapping the toggle and X still work', async ({ page }) => {
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
    await navPanel(page).getByRole('button', { name: 'Close menu' }).tap()
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
