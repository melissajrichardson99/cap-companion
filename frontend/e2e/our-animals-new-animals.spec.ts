import { test, expect, type Locator, type Page } from '@playwright/test'
import { ANIMALS, PLACEHOLDER_PHOTO_SRC } from '../src/animalContent'

// Covers the 11 animals added after the original 9 (first-version general
// content, no photos yet): each one opens by direct URL and from the list,
// shows its "Meet the ...!" heading, tagline, intro and all 5 information
// cards, and renders the shared no-photo placeholder (never a broken
// image). Their QR-scan heatmap logging is covered in
// staff-heatmap-qr-scans.spec.ts alongside the other destination types.
//
// No photos are uploaded for these slugs by any fixture -- if staff upload
// one on the dev DB, the placeholder assertions here would need to change.

const NEW_ANIMALS: { slug: string; name: string }[] = [
  { slug: 'wallaroo', name: 'Wallaroo' },
  { slug: 'tamandua', name: 'Tamandua (Anteater)' },
  { slug: 'sugar-glider', name: 'Sugar Glider' },
  { slug: 'tortoise', name: 'Tortoise' },
  { slug: 'iguana', name: 'Iguana' },
  { slug: 'snake', name: 'Snake' },
  { slug: 'sheep', name: 'Sheep' },
  { slug: 'rabbit', name: 'Rabbit' },
  { slug: 'ferret', name: 'Ferret' },
  { slug: 'chicken', name: 'Chicken' },
  { slug: 'duck', name: 'Duck' },
]

function contentFor(slug: string) {
  const animal = ANIMALS.find((a) => a.slug === slug)
  if (!animal) throw new Error(`No content for ${slug}`)
  return animal
}

async function openAnimalsTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
}

// The placeholder must actually have loaded (naturalWidth > 0) -- a broken
// image has naturalWidth 0 even when its src attribute looks right.
async function expectPlaceholder(img: Locator): Promise<void> {
  await expect(img).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
}

test.describe('Our Animals: the 11 newer animals', () => {
  test('the list shows the original 9 first, then the 11 new animals in order, each with the placeholder photo', async ({
    page,
  }) => {
    await openAnimalsTab(page)
    const names = page.locator('.animal-card-name')
    await expect(names).toHaveCount(20)
    await expect(names).toHaveText(ANIMALS.map((a) => a.name))
    expect(ANIMALS.slice(9).map((a) => ({ slug: a.slug, name: a.name }))).toEqual(NEW_ANIMALS)

    for (const { name } of NEW_ANIMALS) {
      const card = page.locator('.animal-card').filter({ has: page.getByText(name, { exact: true }) })
      await expectPlaceholder(card.locator('img'))
    }
  })

  for (const { slug, name } of NEW_ANIMALS) {
    test(`${name}: direct URL shows heading, tagline, intro, no-photo state and all 5 cards`, async ({ page }) => {
      const animal = contentFor(slug)
      expect(animal.nuggets).toHaveLength(5)

      await page.goto(`/animals/${slug}`)
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(page.locator('.animals-grid')).toHaveCount(0)
      await expect(page.locator('.animal-detail-about-heading')).toHaveText(animal.aboutHeading)
      expect(animal.aboutHeading).toMatch(/^Meet the .+!$/)
      await expect(page.locator('.animal-detail-tagline')).toHaveText(animal.tagline!)
      await expect(page.locator('.animal-detail-description')).toHaveText(animal.description)
      // No facts yet -- the empty table is hidden, not rendered as a blank box.
      await expect(page.locator('.animal-detail-facts-table')).toHaveCount(0)
      await expectPlaceholder(page.locator('img.animal-detail-hero'))

      await page.getByRole('tab', { name: 'Photos' }).click()
      await expect(page.getByText(`No photos of ${name} yet -- check back soon!`)).toBeVisible()
      await expect(page.locator('.animal-detail-photos-grid')).toHaveCount(0)

      await page.getByRole('tab', { name: 'About' }).click()
      await page.getByRole('button', { name: 'View Information Cards' }).click()
      await expect(page).toHaveURL(new RegExp(`/animals/${slug}/cards$`))
      await expect(page.getByRole('heading', { name: `${name} — Information Cards` })).toBeVisible()
      for (let i = 0; i < 5; i++) {
        await expect(page.locator('.animal-cards-counter')).toHaveText(`Card ${i + 1} of 5`)
        await expect(page.locator('.animal-card-nugget-title')).toHaveText(animal.nuggets[i].title)
        await expect(page.locator('.animal-card-nugget-text')).toHaveText(animal.nuggets[i].text)
        await expectPlaceholder(page.locator('img.animal-card-nugget-image'))
        await page.getByRole('button', { name: 'Next card' }).click()
      }
      await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 5')

      // The cards view also opens directly by URL.
      await page.goto(`/animals/${slug}/cards`)
      await expect(page.locator('.animal-card-nugget-title')).toHaveText(animal.nuggets[0].title)
    })
  }

  test('each new animal opens from the Our Animals list', async ({ page }) => {
    await openAnimalsTab(page)
    for (const { slug, name } of NEW_ANIMALS) {
      await page.locator('.animal-card').filter({ has: page.getByText(name, { exact: true }) }).click()
      await expect(page).toHaveURL(new RegExp(`/animals/${slug}$`))
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(page.locator('.animal-detail-tagline')).toHaveText(contentFor(slug).tagline!)
      await page.getByRole('button', { name: 'Back to Our Animals' }).click()
      await expect(page.locator('.animal-card')).toHaveCount(ANIMALS.length)
    }
  })

  test('the tagline is styled as a subtitle, and the original animals have none', async ({ page }) => {
    await page.goto('/animals/tamandua')
    const tagline = page.locator('.animal-detail-tagline')
    const style = await tagline.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { fontStyle: cs.fontStyle, fontWeight: cs.fontWeight, color: cs.color, fontSize: cs.fontSize }
    })
    expect(style).toEqual({ fontStyle: 'italic', fontWeight: '700', color: 'rgb(122, 82, 48)', fontSize: '14px' })

    await page.goto('/animals/capybara')
    await expect(page.locator('.animal-detail-about-heading')).toHaveText("The World's Largest Rodent")
    await expect(page.locator('.animal-detail-tagline')).toHaveCount(0)
    await expect(page.locator('.animal-detail-facts-table')).toBeVisible()
  })
})
