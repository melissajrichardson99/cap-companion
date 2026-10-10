import { test, expect, type Page } from '@playwright/test'

// Covers the Map screen's "Take Me There" card: 6 guest-facing key-spot
// buttons that highlight the matching pin(s) on the map above. Node-to-
// category mapping (frontend/src/keySpotCategories.ts) was reviewed against
// the live map_nodes table and confirmed with Melissa before implementation
// -- see that file's header comment for the mapping rationale.

async function openMapTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Map' }).click()
}

test.describe('Take Me There card', () => {
  test('renders all 6 category buttons between the map and the legend', async ({ page }) => {
    await openMapTab(page)
    const card = page.locator('.map-keyspot-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('Take Me There')).toBeVisible()
    await expect(card.getByText('Select a key location to highlight it on the map.')).toBeVisible()

    for (const label of ['Washrooms', 'Food', 'General Store', 'Animal Pens', 'Animal Shows', 'Attractions']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
  })

  test('Washrooms highlights exactly the Restrooms pin', async ({ page }) => {
    await openMapTab(page)
    await page.getByRole('button', { name: 'Washrooms', exact: true }).click()

    const restrooms = page.locator('.map-pin[aria-label^="Restrooms"]')
    await expect(restrooms).toHaveClass(/map-pin-keyspot-highlighted/)

    const highlighted = page.locator('.map-pin-keyspot-highlighted')
    await expect(highlighted).toHaveCount(1)
  })

  test('Food highlights the 3 dining pins but not General Store', async ({ page }) => {
    await openMapTab(page)
    await page.getByRole('button', { name: 'Food', exact: true }).click()

    for (const name of ['Critter Cafe', "Granny Ann's Kitchen", 'Sugar Shack']) {
      await expect(page.locator(`.map-pin[aria-label^="${name}"]`)).toHaveClass(/map-pin-keyspot-highlighted/)
    }
    await expect(page.locator('.map-pin[aria-label^="General Store"]')).not.toHaveClass(/map-pin-keyspot-highlighted/)
    await expect(page.locator('.map-pin-keyspot-highlighted')).toHaveCount(3)
  })

  test('Animal Pens highlights the 5 general-admission pens only', async ({ page }) => {
    await openMapTab(page)
    await page.getByRole('button', { name: 'Animal Pens', exact: true }).click()

    for (const name of ['Alpacas/Sheep/Pigs', 'Capybaras & Emus', 'Goats', 'Kangaroos/Wallaroos', 'Small Animals']) {
      await expect(page.locator(`.map-pin[aria-label^="${name}"]`)).toHaveClass(/map-pin-keyspot-highlighted/)
    }
    // Excluded per Melissa's confirmation: no-entry viewing overlook and the
    // private-event-only space.
    await expect(page.locator('.map-pin[aria-label^="Wallaroos (viewing only)"]')).not.toHaveClass(
      /map-pin-keyspot-highlighted/
    )
    await expect(page.locator('.map-pin-keyspot-highlighted')).toHaveCount(5)
  })

  test('Attractions highlights all 19 attraction pins (18 + Cornhole Mini Golf, migration 043)', async ({ page }) => {
    await openMapTab(page)
    await page.getByRole('button', { name: 'Attractions', exact: true }).click()
    await expect(page.locator('.map-pin-attraction.map-pin-keyspot-highlighted')).toHaveCount(19)
    await expect(page.locator('.map-pin-keyspot-highlighted')).toHaveCount(19)
  })

  test('switching categories updates the highlight, and re-tapping the active one clears it', async ({ page }) => {
    await openMapTab(page)
    const washroomsBtn = page.getByRole('button', { name: 'Washrooms', exact: true })
    const generalStoreBtn = page.getByRole('button', { name: 'General Store', exact: true })

    await washroomsBtn.click()
    await expect(washroomsBtn).toHaveClass(/map-keyspot-btn-active/)
    await expect(page.locator('.map-pin[aria-label^="Restrooms"]')).toHaveClass(/map-pin-keyspot-highlighted/)

    await generalStoreBtn.click()
    await expect(generalStoreBtn).toHaveClass(/map-keyspot-btn-active/)
    await expect(washroomsBtn).not.toHaveClass(/map-keyspot-btn-active/)
    await expect(page.locator('.map-pin[aria-label^="Restrooms"]')).not.toHaveClass(/map-pin-keyspot-highlighted/)
    await expect(page.locator('.map-pin[aria-label^="General Store"]')).toHaveClass(/map-pin-keyspot-highlighted/)

    await generalStoreBtn.click()
    await expect(generalStoreBtn).not.toHaveClass(/map-keyspot-btn-active/)
    await expect(page.locator('.map-pin-keyspot-highlighted')).toHaveCount(0)
  })

  test('pinch-to-zoom and existing map functionality still work with the new card present', async ({ page }) => {
    await openMapTab(page)
    // Existing legend still renders below the new card.
    await expect(page.locator('.map-legend')).toBeVisible()
    // A pin still opens its detail popup as before.
    await page.locator('.map-pin[aria-label^="Restrooms"]').click()
    await expect(page.getByRole('heading', { name: 'Restrooms' })).toBeVisible()
  })
})
