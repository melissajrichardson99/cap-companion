import { test, expect, type Page } from '@playwright/test'
import { FOOD_TRUCKS } from '../src/foodTruckContent'
import { PAGE_SUBHEADERS } from '../src/pageSubheaderContent'

// Covers the "Food Truck Menus" page -- the last major unbuilt item from the
// original app plan. All content is frontend-only (foodTruckContent.ts, no
// DB/staff-editable toggle), same static pattern as HomePage's schedule/
// hours, since real prices aren't finalized yet.
//
// The guest nav is a closed-by-default hamburger dropdown -- every tab click
// below opens it first via "Open menu", per NavMenu.tsx.

async function openFoodTrucksTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Food Truck Menus' }).click()
}

function truckCard(page: Page, slug: string) {
  return page.locator(`[data-truck="${slug}"]`)
}

test.describe('Food Truck Menus', () => {
  test('reachable from the nav and renders the sign-board title, subtitle, and all three trucks', async ({ page }) => {
    await openFoodTrucksTab(page)
    await expect(page.getByRole('heading', { name: 'Food Truck Menus' })).toBeVisible()
    await expect(page.getByText(PAGE_SUBHEADERS.foodTrucks)).toBeVisible()
    await expect(page.locator('.foodtruck-card')).toHaveCount(FOOD_TRUCKS.length)
  })

  test("Granny Ann's Kitchen renders its items, priced Fries, and Drinks side box", async ({ page }) => {
    await openFoodTrucksTab(page)
    const card = truckCard(page, 'granny-anns-kitchen')
    await expect(card).toContainText("Granny Ann's Kitchen")
    await expect(card).toContainText('Burgers, bites & all your favourites!')
    await expect(card).toContainText('Burger')
    await expect(card).toContainText('Fries')
    await expect(card).toContainText('$4.49')
    await expect(card.getByText('Drinks', { exact: true })).toBeVisible()
    await expect(card).toContainText('Soft Drink')
    await expect(card).toContainText('$2.75')
    await expect(card.locator('.foodtruck-seasonal-badge')).toHaveCount(0)
  })

  test('Sugar Shack renders its items and Flavours side box', async ({ page }) => {
    await openFoodTrucksTab(page)
    const card = truckCard(page, 'sugar-shack')
    await expect(card).toContainText('Sugar Shack')
    await expect(card).toContainText('Sweet treats to make your day!')
    await expect(card).toContainText('Slushie')
    await expect(card).toContainText('$3.99')
    await expect(card.getByText('Flavours', { exact: true })).toBeVisible()
    await expect(card).toContainText('Bubblegum')
  })

  test('Critter Cafe shows the Fall Only badge and its two side-by-side boxes (Hot Drinks, Snacks)', async ({ page }) => {
    await openFoodTrucksTab(page)
    const card = truckCard(page, 'critter-cafe')
    await expect(card).toContainText('Critter Cafe')
    await expect(card).toContainText('Warm drinks & cozy snacks!')
    await expect(card.locator('.foodtruck-seasonal-badge')).toHaveText('Fall Only')
    await expect(card.getByText('Hot Drinks', { exact: true })).toBeVisible()
    await expect(card).toContainText('Coffee')
    await expect(card).toContainText('$2.99')
    await expect(card.getByText('Snacks', { exact: true })).toBeVisible()
    await expect(card).toContainText('Popcorn')
    await expect(card).toContainText('$3.49')
  })

  test('every priceable menu item renders a price (Flavours stays unpriced)', async ({ page }) => {
    await openFoodTrucksTab(page)
    for (const truck of FOOD_TRUCKS) {
      const card = truckCard(page, truck.slug)
      for (const item of truck.menuItems) {
        await expect(item.price, `${truck.name}'s ${item.name} is missing a price`).toBeTruthy()
        const row = card.locator('.foodtruck-menu-item').filter({ has: page.getByText(item.name, { exact: true }) })
        await expect(row.locator('.foodtruck-menu-item-price')).toHaveText(item.price!)
      }
    }
    // Flavours is a flavor-choice list for an already-priced Ice Cream item,
    // not separate purchasable items -- its rows stay unpriced by design.
    const flavourRow = truckCard(page, 'sugar-shack').locator('.foodtruck-sidebox-list .foodtruck-menu-item', {
      hasText: 'Vanilla',
    })
    await expect(flavourRow.locator('.foodtruck-menu-item-price')).toHaveCount(0)
  })

  test('each truck card renders its own distinct accent color', async ({ page }) => {
    await openFoodTrucksTab(page)
    const colors = await Promise.all(
      FOOD_TRUCKS.map((truck) =>
        truckCard(page, truck.slug)
          .locator('.foodtruck-ribbon')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ),
    )
    expect(new Set(colors).size).toBe(FOOD_TRUCKS.length)
  })

  test('bottom note bar renders the disclaimer and closing sign', async ({ page }) => {
    await openFoodTrucksTab(page)
    await expect(
      page.getByText('Please Note: Menu items and prices are subject to change. Thank you for supporting our food trucks!'),
    ).toBeVisible()
    await expect(page.getByText('Thank You & Enjoy Your Visit!')).toBeVisible()
  })
})
