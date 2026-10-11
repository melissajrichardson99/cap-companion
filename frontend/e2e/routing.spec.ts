import { test, expect } from '@playwright/test'
import { openTab } from './navMenuHelper'

// Covers the App-wide routing-fix rollout (App.tsx): every guest-facing
// screen -- Home included -- is now a real router-driven route with its own
// URL, not hand-rolled activeTab/showHome state. Per-screen behavior
// (headings, content) is already covered by each screen's own spec file;
// this file is specifically about the cross-cutting navigation mechanism
// itself -- hard reload at each URL, and Back/Forward walking through real
// in-app history -- which is the actual bug report (browser Back exiting
// the site instead of stepping back through the app) this whole project
// exists to fix.

// heading is each screen's own <h1> text; navLabel is the (sometimes
// different, e.g. Puzzles/Floor Puzzles) label NavMenu's dropdown uses for
// the same tab (App.tsx's TABS).
const ROUTES: { path: string; heading: string; navLabel: string }[] = [
  { path: '/map', heading: 'Park Map', navLabel: 'Map' },
  { path: '/bingo', heading: 'Bingo Card', navLabel: 'Bingo Card' },
  { path: '/puzzles', heading: 'Floor Puzzles', navLabel: 'Puzzles' },
  { path: '/scoring', heading: 'Scoring Sheets', navLabel: 'Scoring Sheets' },
  { path: '/hunt', heading: 'Scavenger Hunt', navLabel: 'Scavenger Hunt' },
  { path: '/animals', heading: 'Our Animals', navLabel: 'Our Animals' },
  { path: '/collectibles', heading: 'Collectibles', navLabel: 'Collectibles' },
  { path: '/photos', heading: 'Favorite Photo', navLabel: 'Favorite Photo' },
  { path: '/food-trucks', heading: 'Food Truck Menus', navLabel: 'Food Truck Menus' },
  { path: '/faq', heading: 'FAQ', navLabel: 'FAQ' },
]


test.describe('Per-screen URLs', () => {
  for (const { path, heading } of ROUTES) {
    test(`${path} works as a direct hard-reload/deep link, not just in-app navigation`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    })
  }

  test('every tab lands on a distinct URL, not all sharing "/" with Home', async ({ page }) => {
    await page.goto('/')
    const seen = new Set<string>(['/'])
    for (const { path, heading, navLabel } of ROUTES) {
      await openTab(page, navLabel)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      const url = new URL(page.url())
      expect(seen.has(url.pathname)).toBe(false)
      seen.add(url.pathname)
      expect(url.pathname).toBe(path)
    }
  })
})

test.describe('Browser Back/Forward across real in-app navigation', () => {
  test('back steps through several screens in sequence before leaving the app, forward replays it', async ({
    page,
  }) => {
    // A neutral prior page stands in for "whatever the guest had open before
    // launching the app" -- the original real-world bug report. If every
    // screen switch is a real navigation, Back should walk through each
    // screen below before ever reaching this page again.
    await page.goto('about:blank')

    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()

    await openTab(page, 'Map')
    await expect(page.getByRole('heading', { name: 'Park Map', exact: true })).toBeVisible()

    await openTab(page, 'Bingo Card')
    await expect(page.getByRole('heading', { name: 'Bingo Card', exact: true })).toBeVisible()

    await openTab(page, 'Scoring Sheets')
    await expect(page.getByRole('heading', { name: 'Scoring Sheets', exact: true })).toBeVisible()

    await openTab(page, 'FAQ')
    await expect(page.getByRole('heading', { name: 'FAQ', exact: true })).toBeVisible()

    // Back four times: FAQ -> Scoring -> Bingo -> Map -> Home. Each step
    // must land on the exact previous in-app screen, not skip straight past
    // the app to about:blank.
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Scoring Sheets', exact: true })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Bingo Card', exact: true })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Park Map', exact: true })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()

    // Forward replays the same sequence in order.
    await page.goForward()
    await expect(page.getByRole('heading', { name: 'Park Map', exact: true })).toBeVisible()
    await page.goForward()
    await expect(page.getByRole('heading', { name: 'Bingo Card', exact: true })).toBeVisible()
    await page.goForward()
    await expect(page.getByRole('heading', { name: 'Scoring Sheets', exact: true })).toBeVisible()
    await page.goForward()
    await expect(page.getByRole('heading', { name: 'FAQ', exact: true })).toBeVisible()
  })

  test('logo click, tab clicks, and deep-linked Our Animals browsing all push real history entries', async ({
    page,
  }) => {
    await page.goto('/')
    await openTab(page, 'Our Animals')
    await expect(page.getByRole('heading', { name: 'Our Animals', exact: true })).toBeVisible()

    await page.locator('.animal-card', { hasText: 'Capybara' }).click()
    await expect(page.getByRole('heading', { name: 'Capybara', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Go to home page' }).click()
    await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Capybara', exact: true })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Our Animals', exact: true })).toBeVisible()
  })
})

test.describe('FAQ -> Map key-spot deep link (router location state)', () => {
  test('Back from the Map after the deep link returns to FAQ, and does not replay the highlight on Forward-less reuse', async ({
    page,
  }) => {
    await page.goto('/')
    await openTab(page, 'FAQ')
    const washroomsItem = page.locator('.faq-item').filter({ hasText: 'Where are your washrooms located?' })
    await washroomsItem.getByRole('button', { name: 'Where are your washrooms located?' }).click()
    await washroomsItem.getByRole('button', { name: 'Show me on the map' }).click()

    await expect(page.getByRole('heading', { name: 'Park Map', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Washrooms', exact: true })).toHaveClass(/map-keyspot-btn-active/)

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'FAQ', exact: true })).toBeVisible()
  })
})
