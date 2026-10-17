import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import { openTab } from './navMenuHelper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// Covers the Staff Page's "Animal Photos" tab (Staff-Managed Animal Photos):
// staff upload/delete/reorder against the animal-photos API, and that each
// action is reflected on the public Our Animals page. Targets Pig (3
// migrated photos, seeded by backend/scripts/migrate_animal_photos.py) --
// deliberately NOT Capybara/Goat/Kangaroo/etc., which our-animals.spec.ts
// and photo-lightbox.spec.ts assert exact counts/order against. Every test
// below restores Pig's photo set to its original count/order before
// finishing (this DB persists across spec files, same "clean up after
// yourself" discipline as favorite-photo.spec.ts), and the suite runs with
// workers: 1 / fullyParallel: false (playwright.config.ts), so there's no
// cross-file race on the animal this file mutates.
//
// Deliberately does NOT touch Collectibles -- that pool is unaffected by
// anything here (see animalContent.ts's imageCandidates() / CLAUDE.md-level
// scope note), so there's nothing to assert or clean up on that side.

const ANIMAL_SLUG = 'pig'
const ANIMAL_NAME = 'Pig'

async function openStaffAnimalPhotos(page: Page): Promise<void> {
  await loginAsStaff(page)
  await page.getByRole('tab', { name: 'Animal Photos' }).click()
  await page.getByRole('tab', { name: ANIMAL_NAME }).click()
}

async function openPublicAnimalPhotos(page: Page): Promise<void> {
  await page.goto('/')
  await openTab(page, 'Our Animals')
  await page.locator('.animal-card', { hasText: ANIMAL_NAME }).click()
  await page.getByRole('tab', { name: 'Photos' }).click()
}

async function imgSrcs(locator: ReturnType<Page['locator']>): Promise<string[]> {
  return locator.evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src))
}

test.describe('Staff Page: Animal Photos', () => {
  test('upload adds a new photo, visible in the Staff gallery and on the public Our Animals page', async ({
    page,
    context,
  }) => {
    await openStaffAnimalPhotos(page)
    await expect(page.locator('.staff-photo-row')).toHaveCount(3)

    await page.locator('.staff-animal-photo-upload-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
    await page.getByRole('button', { name: 'Upload Photo' }).click()
    await expect(page.locator('.staff-photo-row')).toHaveCount(4)

    const publicPage = await context.newPage()
    await openPublicAnimalPhotos(publicPage)
    await expect(publicPage.locator('.animal-detail-photos-grid img')).toHaveCount(4)

    // Clean up: delete the photo this test uploaded, restoring Pig to its
    // original 3 migrated photos.
    page.on('dialog', (dialog) => dialog.accept())
    await page.locator('.staff-photo-row').last().getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.staff-photo-row')).toHaveCount(3)
  })

  test('delete removes a photo from the Staff gallery and the public Our Animals page', async ({ page, context }) => {
    await openStaffAnimalPhotos(page)

    // Upload a throwaway photo first -- never delete one of Pig's original 3
    // migrated photos, those belong to our-animals.spec.ts's assertions.
    await page.locator('.staff-animal-photo-upload-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
    await page.getByRole('button', { name: 'Upload Photo' }).click()
    await expect(page.locator('.staff-photo-row')).toHaveCount(4)

    page.on('dialog', (dialog) => dialog.accept())
    await page.locator('.staff-photo-row').last().getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.staff-photo-row')).toHaveCount(3)

    const publicPage = await context.newPage()
    await openPublicAnimalPhotos(publicPage)
    await expect(publicPage.locator('.animal-detail-photos-grid img')).toHaveCount(3)
  })

  test('reorder (Up/Down) changes display order, reflected on the public page, then is restored', async ({
    page,
    context,
  }) => {
    await openStaffAnimalPhotos(page)
    const rows = page.locator('.staff-photo-row')
    await expect(rows).toHaveCount(3)
    const originalSrcs = await imgSrcs(rows.locator('img'))

    // Move the first photo down one spot: [1, 2, 3] -> [2, 1, 3]. The
    // reorder call is async (staffRequest -> reload), so wait for the DOM to
    // actually reflect the new order before reading it -- a plain locator
    // read right after the click can race ahead of the still-in-flight
    // request/reload.
    await rows.nth(0).getByRole('button', { name: 'Move photo down' }).click()
    await expect(rows.nth(0).locator('img')).toHaveAttribute('src', originalSrcs[1])
    const reorderedSrcs = await imgSrcs(rows.locator('img'))
    expect(reorderedSrcs).toEqual([originalSrcs[1], originalSrcs[0], originalSrcs[2]])

    const publicPage = await context.newPage()
    await openPublicAnimalPhotos(publicPage)
    const publicSrcs = await imgSrcs(publicPage.locator('.animal-detail-photos-grid img'))
    expect(publicSrcs).toEqual(reorderedSrcs)

    // Restore the original order: [2, 1, 3] -> [1, 2, 3].
    await rows.nth(0).getByRole('button', { name: 'Move photo down' }).click()
    await expect(rows.nth(0).locator('img')).toHaveAttribute('src', originalSrcs[0])
    const restoredSrcs = await imgSrcs(rows.locator('img'))
    expect(restoredSrcs).toEqual(originalSrcs)
  })

  test('staff-only endpoints reject requests with no Authorization header', async ({ page }) => {
    await page.goto('/')
    const statuses = await page.evaluate(async (slug) => {
      const fakeId = crypto.randomUUID()
      const responses = await Promise.all([
        fetch(`http://localhost:8000/animal-photos/${slug}`, { method: 'POST', body: new FormData() }),
        fetch(`http://localhost:8000/animal-photos/${fakeId}`, { method: 'DELETE' }),
        fetch(`http://localhost:8000/animal-photos/${slug}/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_ids: [] }),
        }),
      ])
      return responses.map((r) => r.status)
    }, ANIMAL_SLUG)
    expect(statuses).toEqual([401, 401, 401])
  })
})
