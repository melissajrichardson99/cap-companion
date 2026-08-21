import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// Shared full-screen click-to-expand photo viewer (PhotoLightbox.tsx), wired
// into Our Animals (hero + Photos-tab grid), Favorite Photo's voting gallery,
// Home Page's Photo of the Day, Food Truck photos, and Family Passport's
// group photo. The Our Animals flashcard screen deliberately does NOT get
// the lightbox (its own Card X of Y nav already covers that image, and
// stacking a second navigation scheme on the same image would confuse the
// two) -- untouched, so no interference risk there.

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Open menu' }).click()
}

function lightbox(page: Page) {
  return page.getByRole('dialog', { name: 'Photo viewer' })
}

async function bodyOverflow(page: Page) {
  return page.evaluate(() => document.body.style.overflow)
}

test.describe('PhotoLightbox', () => {
  test.describe('Our Animals', () => {
    async function openAnimal(page: Page, name: string) {
      await page.goto('/')
      await openMenu(page)
      await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
      await page.locator('.animal-card', { hasText: name }).click()
    }

    test('hero image opens a single-photo lightbox with no nav controls, closes via X/backdrop/Escape', async ({
      page,
    }) => {
      await openAnimal(page, 'Capybara')
      const heroSrc = await page.locator('.animal-detail-hero').getAttribute('src')

      await page.locator('.animal-detail-hero').click()
      const box = lightbox(page)
      await expect(box).toBeVisible()
      await expect(box.locator('.photo-lightbox-image')).toHaveAttribute('src', heroSrc!)
      await expect(box.getByRole('button', { name: 'Previous photo' })).toHaveCount(0)
      await expect(box.getByRole('button', { name: 'Next photo' })).toHaveCount(0)
      await expect(box.locator('.photo-lightbox-counter')).toHaveCount(0)

      // Close via the X button.
      await box.getByRole('button', { name: 'Close photo viewer' }).click()
      await expect(lightbox(page)).toHaveCount(0)

      // Close via backdrop click (outside the image itself).
      await page.locator('.animal-detail-hero').click()
      await expect(lightbox(page)).toBeVisible()
      await page.locator('.photo-lightbox-backdrop').click({ position: { x: 5, y: 5 } })
      await expect(lightbox(page)).toHaveCount(0)

      // Close via Escape.
      await page.locator('.animal-detail-hero').click()
      await expect(lightbox(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(lightbox(page)).toHaveCount(0)
    })

    test('clicking the image itself does not close the lightbox (only the backdrop does)', async ({ page }) => {
      await openAnimal(page, 'Capybara')
      await page.locator('.animal-detail-hero').click()
      await expect(lightbox(page)).toBeVisible()
      await lightbox(page).locator('.photo-lightbox-image').click()
      await expect(lightbox(page)).toBeVisible()
    })

    test('Photos tab grid opens a multi-photo lightbox at the clicked index, with working prev/next and wraparound', async ({
      page,
    }) => {
      await openAnimal(page, 'Capybara')
      await page.getByRole('tab', { name: 'Photos' }).click()
      const grid = page.locator('.animal-detail-photos-grid img')
      await expect(grid).toHaveCount(5)
      const thirdSrc = await grid.nth(2).getAttribute('src')

      await grid.nth(2).click()
      const box = lightbox(page)
      await expect(box).toBeVisible()
      await expect(box.locator('.photo-lightbox-image')).toHaveAttribute('src', thirdSrc!)
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('3 / 5')

      await box.getByRole('button', { name: 'Next photo' }).click()
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('4 / 5')
      await box.getByRole('button', { name: 'Previous photo' }).click()
      await box.getByRole('button', { name: 'Previous photo' }).click()
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('2 / 5')

      // Arrow-key navigation.
      await page.keyboard.press('ArrowRight')
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('3 / 5')
      await page.keyboard.press('ArrowLeft')
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('2 / 5')

      // Wraparound: from photo 2, Previous x2 lands on photo 5 then 4... go to 1 then Previous wraps to 5.
      await box.getByRole('button', { name: 'Previous photo' }).click()
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('1 / 5')
      await box.getByRole('button', { name: 'Previous photo' }).click()
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('5 / 5')
      await box.getByRole('button', { name: 'Next photo' }).click()
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('1 / 5')
    })

    test('swipe gesture navigates between photos', async ({ page }) => {
      await openAnimal(page, 'Capybara')
      await page.getByRole('tab', { name: 'Photos' }).click()
      await page.locator('.animal-detail-photos-grid img').first().click()
      const box = lightbox(page)
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('1 / 5')

      // .photo-lightbox-stage carries role="dialog" itself (it IS `box`, not
      // a descendant of it) -- evaluate directly on box.
      await box.evaluate((el) => {
        const start = new Touch({ identifier: 1, target: el, clientX: 300, clientY: 300 })
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [start], bubbles: true }))
        const end = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 300 })
        el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [end], bubbles: true }))
      })
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('2 / 5')

      // Swipe left-to-right (a rightward drag) -- should go back to the previous photo.
      await box.evaluate((el) => {
        const start = new Touch({ identifier: 2, target: el, clientX: 100, clientY: 300 })
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [start], bubbles: true }))
        const end = new Touch({ identifier: 2, target: el, clientX: 300, clientY: 300 })
        el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [end], bubbles: true }))
      })
      await expect(box.locator('.photo-lightbox-counter')).toHaveText('1 / 5')
    })

    test('body scroll is locked while open and restored after closing', async ({ page }) => {
      await openAnimal(page, 'Capybara')
      expect(await bodyOverflow(page)).not.toBe('hidden')

      await page.locator('.animal-detail-hero').click()
      await expect(lightbox(page)).toBeVisible()
      expect(await bodyOverflow(page)).toBe('hidden')

      await page.keyboard.press('Escape')
      await expect(lightbox(page)).toHaveCount(0)
      expect(await bodyOverflow(page)).not.toBe('hidden')
    })
  })

  test.describe('Favorite Photo gallery', () => {
    test('gallery photos open a multi-photo lightbox, swipeable across the loaded gallery', async ({
      page,
      context,
    }) => {
      const labelA = `E2E Lightbox A ${Date.now()}`
      const labelB = `E2E Lightbox B ${Date.now()}`

      for (const label of [labelA, labelB]) {
        await page.goto('/')
        await openMenu(page)
        await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
        await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
        await page.getByPlaceholder('Your name (optional)').fill(label)
        await page.getByRole('button', { name: 'Submit Photo' }).click()
        await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()
      }

      const staffPage = await context.newPage()
      staffPage.on('dialog', (dialog) => dialog.accept())
      await loginAsStaff(staffPage)
      for (const label of [labelA, labelB]) {
        const row = staffPage.locator('.staff-photo-row', { hasText: label })
        await expect(row).toBeVisible()
        await row.getByRole('button', { name: 'Approve' }).click()
        await expect(staffPage.locator('.staff-photo-row', { hasText: label })).toHaveCount(0)
      }

      await page.goto('/')
      await openMenu(page)
      await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
      const cardA = page.locator('.photo-card', { hasText: labelA })
      await expect(cardA).toBeVisible()

      await cardA.locator('.photo-card-image').click()
      const box = lightbox(page)
      await expect(box).toBeVisible()
      await expect(box.getByRole('button', { name: 'Next photo' })).toBeVisible()
      const counterText = await box.locator('.photo-lightbox-counter').textContent()
      expect(counterText).toMatch(/^\d+ \/ \d+$/)

      const [, totalStr] = counterText!.split(' / ')
      const total = Number(totalStr)
      expect(total).toBeGreaterThanOrEqual(2)

      await box.getByRole('button', { name: 'Next photo' }).click()
      const nextCounter = await box.locator('.photo-lightbox-counter').textContent()
      expect(nextCounter).not.toBe(counterText)

      await box.getByRole('button', { name: 'Close photo viewer' }).click()
      await expect(lightbox(page)).toHaveCount(0)

      // Clean up the shortlisted photos this test created (same reasoning as
      // favorite-photo.spec.ts -- leaving them would affect later runs of
      // home-page.spec.ts / favorite-photo.spec.ts's own assertions).
      for (const label of [labelA, labelB]) {
        await staffPage
          .locator('.staff-shortlisted-row', { hasText: label })
          .getByRole('button', { name: 'Remove' })
          .click()
        await expect(staffPage.locator('.staff-shortlisted-row', { hasText: label })).toHaveCount(0)
      }
    })
  })

  test.describe('Home Page — Photo of the Day', () => {
    test('single-photo context: opens with no prev/next arrows or counter', async ({ page, context }) => {
      const label = `E2E Home Lightbox ${Date.now()}`
      await page.goto('/')
      await openMenu(page)
      await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
      await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
      await page.getByPlaceholder('Your name (optional)').fill(label)
      await page.getByRole('button', { name: 'Submit Photo' }).click()
      await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()

      const staffPage = await context.newPage()
      staffPage.on('dialog', (dialog) => dialog.accept())
      await loginAsStaff(staffPage)
      const row = staffPage.locator('.staff-photo-row', { hasText: label })
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: 'Approve' }).click()

      await page.goto('/')
      const homeImage = page.locator('.home-photo-image')
      await expect(homeImage).toBeVisible()

      await homeImage.click()
      const box = lightbox(page)
      await expect(box).toBeVisible()
      await expect(box.getByRole('button', { name: 'Previous photo' })).toHaveCount(0)
      await expect(box.getByRole('button', { name: 'Next photo' })).toHaveCount(0)
      await expect(box.locator('.photo-lightbox-counter')).toHaveCount(0)

      await box.getByRole('button', { name: 'Close photo viewer' }).click()
      await expect(lightbox(page)).toHaveCount(0)

      await staffPage
        .locator('.staff-shortlisted-row', { hasText: label })
        .getByRole('button', { name: 'Remove' })
        .click()
    })
  })

  test.describe('Food Truck Menus', () => {
    test('truck photo opens a single-photo lightbox', async ({ page }) => {
      await page.goto('/')
      await openMenu(page)
      await page.getByRole('menuitemradio', { name: 'Food Truck Menus' }).click()
      const card = page.locator('[data-truck="granny-anns-kitchen"]')
      const photoSrc = await card.locator('.foodtruck-photo').getAttribute('src')

      await card.locator('.foodtruck-photo').click()
      const box = lightbox(page)
      await expect(box).toBeVisible()
      await expect(box.locator('.photo-lightbox-image')).toHaveAttribute('src', photoSrc!)
      await expect(box.locator('.photo-lightbox-counter')).toHaveCount(0)
      await box.getByRole('button', { name: 'Close photo viewer' }).click()
      await expect(lightbox(page)).toHaveCount(0)
    })
  })

  test.describe('responsive rendering', () => {
    test('renders correctly at desktop width', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await openMenu(page)
      await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
      await page.locator('.animal-card', { hasText: 'Capybara' }).click()
      await page.locator('.animal-detail-hero').click()
      await expect(lightbox(page)).toBeVisible()
      await expect(lightbox(page).locator('.photo-lightbox-image')).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: 'test-results/lightbox-desktop.png' })
    })

    test('renders correctly at mobile width', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/')
      await openMenu(page)
      await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
      await page.locator('.animal-card', { hasText: 'Capybara' }).click()
      await page.locator('.animal-detail-hero').click()
      await expect(lightbox(page)).toBeVisible()
      await expect(lightbox(page).locator('.photo-lightbox-image')).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: 'test-results/lightbox-mobile.png' })
    })
  })
})
