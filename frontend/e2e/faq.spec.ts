import { test, expect, type Page } from '@playwright/test'
import { FAQ_ENTRIES } from '../src/faqContent'
import { PAGE_SUBHEADERS } from '../src/pageSubheaderContent'
import { openTab } from './navMenuHelper'

// Covers the FAQ page: an expandable Q&A accordion (faqContent.ts, same
// frontend-only static-content pattern as foodTruckContent.ts) plus a
// closing "Still need help?" card. The Washrooms entry also deep-links into
// the Map page's existing "Take Me There" > Washrooms highlight
// (keySpotCategories.ts) via MapScreen's initialKeySpot prop.
//
// The guest nav is a closed-by-default hamburger dropdown -- every tab click
// below opens it first via "Open menu", per NavMenu.tsx (same convention as
// food-truck-menus.spec.ts/map-keyspot.spec.ts).

async function openFaqTab(page: Page): Promise<void> {
  await page.goto('/')
  await openTab(page, 'FAQ')
}

function faqItem(page: Page, question: string) {
  return page.locator('.faq-item').filter({ hasText: question })
}

test.describe('FAQ page', () => {
  test('reachable from the nav and renders the sign-board title, subtitle, and all 7 entries collapsed', async ({
    page,
  }) => {
    await openFaqTab(page)
    await expect(page.getByRole('heading', { name: 'FAQ' })).toBeVisible()
    await expect(page.getByText(PAGE_SUBHEADERS.faq)).toBeVisible()
    await expect(page.locator('.faq-item')).toHaveCount(FAQ_ENTRIES.length)

    for (const entry of FAQ_ENTRIES) {
      const item = faqItem(page, entry.question)
      await expect(item.getByRole('button', { name: entry.question })).toBeVisible()
      await expect(item.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
      await expect(item).not.toContainText(entry.answer)
    }
  })

  test('each entry expands to reveal its answer and collapses again on re-click', async ({ page }) => {
    await openFaqTab(page)
    for (const entry of FAQ_ENTRIES) {
      const item = faqItem(page, entry.question)
      const toggle = item.getByRole('button', { name: entry.question })

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(item).toContainText(entry.answer)

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(item).not.toContainText(entry.answer)
    }
  })

  test('multiple entries can be open at the same time', async ({ page }) => {
    await openFaqTab(page)
    const first = faqItem(page, FAQ_ENTRIES[0].question)
    const second = faqItem(page, FAQ_ENTRIES[1].question)

    await first.getByRole('button').click()
    await second.getByRole('button').click()

    await expect(first).toContainText(FAQ_ENTRIES[0].answer)
    await expect(second).toContainText(FAQ_ENTRIES[1].answer)
  })

  test('"Still need help?" card renders with the General Store copy', async ({ page }) => {
    await openFaqTab(page)
    await expect(page.getByRole('heading', { name: 'Still need help?' })).toBeVisible()
    await expect(page.getByText("Visit the General Store or ask any staff member. We're here to help!")).toBeVisible()
  })

  test('Washrooms answer\'s "Show me on the map" jumps to the Map page with Washrooms highlighted', async ({ page }) => {
    await openFaqTab(page)
    const washroomsItem = faqItem(page, 'Where are your washrooms located?')
    await washroomsItem.getByRole('button', { name: 'Where are your washrooms located?' }).click()
    await washroomsItem.getByRole('button', { name: 'Show me on the map' }).click()

    await expect(page.getByRole('heading', { name: 'Park Map' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Washrooms', exact: true })).toHaveClass(/map-keyspot-btn-active/)
    await expect(page.locator('.map-pin[aria-label^="Restrooms"]')).toHaveClass(/map-pin-keyspot-highlighted/)
  })

  test('no horizontal overflow at desktop or mobile widths', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await openFaqTab(page)
      // Open one entry so the expanded-answer layout is exercised too, not
      // just the collapsed list.
      await faqItem(page, FAQ_ENTRIES[0].question).getByRole('button').click()

      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    }
  })
})
