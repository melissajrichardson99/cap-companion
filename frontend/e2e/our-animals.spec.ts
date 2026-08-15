import { test, expect, type Page } from '@playwright/test'
import { ANIMALS } from '../src/animalContent'

// Covers the "Our Animals" feature (rebranded Encyclopedia, Plan.md 2.5/5):
// the 6-animal list + name search, the individual animal detail page's
// About/Photos tabs (no third Fun Facts tab), the Photos tab's plain
// uncategorized grid (no filter/voting UI), the information-cards flashcard
// view's text counter + linear side-arrow navigation (no dots, no Shuffle/
// bottom Next button), and the list screen's QR scan entry point. All
// content here is frontend-only real content (animalContent.ts) with no
// backend dependency, unlike most other specs in this suite. Facts are a
// flexible { label, value }[] list (length varies per animal, always 6 here)
// rather than a fixed schema -- assertions below check labels present in the
// current content rather than hardcoding a fixed 5-row table.
//
// The guest nav is a closed-by-default hamburger dropdown -- every
// tab click below opens it first via "Open menu", per NavMenu.tsx.

async function openAnimalsTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
}

function animalCard(page: Page, name: string) {
  return page.locator('.animal-card', { hasText: name })
}

test.describe('Our Animals', () => {
  test('renders all 6 animal cards, searchable by name', async ({ page }) => {
    await openAnimalsTab(page)
    await expect(page.locator('.animal-card')).toHaveCount(ANIMALS.length)
    for (const animal of ANIMALS) {
      await expect(animalCard(page, animal.name)).toBeVisible()
    }

    await page.getByLabel('Search animals by name').fill('kang')
    await expect(page.locator('.animal-card')).toHaveCount(1)
    await expect(animalCard(page, 'Kangaroo')).toBeVisible()

    await page.getByLabel('Search animals by name').fill('zzz-no-match')
    await expect(page.locator('.animal-card')).toHaveCount(0)
    await expect(page.getByText('No animals match "zzz-no-match".')).toBeVisible()
  })

  test('opening an animal card shows exactly two tabs (About, Photos), no Fun Facts tab', async ({ page }) => {
    await openAnimalsTab(page)
    await animalCard(page, 'Capybara').click()

    await expect(page.getByRole('heading', { name: 'Capybara', exact: true })).toBeVisible()
    const tabs = page.locator('[role="tab"]')
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(0)).toHaveText('About')
    await expect(tabs.nth(1)).toHaveText('Photos')
    await expect(page.getByRole('tab', { name: 'Fun Facts' })).toHaveCount(0)

    // About tab: heading, description, facts table (flexible label/value
    // list) + View Information Cards button, on by default.
    await expect(page.locator('.animal-detail-about-heading')).toHaveText("The World's Largest Rodent")
    await expect(page.locator('.animal-detail-description')).toContainText('largest living rodents')
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Scientific name')
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Hydrochoerus hydrochaeris')
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Diet')
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Habitat')
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Conservation')
    await expect(page.getByRole('button', { name: 'View Information Cards' })).toBeVisible()
  })

  test('Kangaroo facts render distinct Type and Group rows (no label collision)', async ({ page }) => {
    await openAnimalsTab(page)
    await animalCard(page, 'Kangaroo').click()

    const rows = page.locator('.animal-detail-facts-table tr')
    await expect(rows.filter({ hasText: 'Type' }).locator('td')).toHaveText('Marsupial')
    await expect(rows.filter({ hasText: 'Group' }).locator('td')).toHaveText('Mob')
  })

  test('no "coming soon" placeholder text remains in Our Animals', async ({ page }) => {
    await openAnimalsTab(page)
    for (const animal of ANIMALS) {
      await animalCard(page, animal.name).click()
      await expect(page.getByText(/coming soon/i)).toHaveCount(0)
      await expect(page.getByText(/placeholder/i)).toHaveCount(0)

      await page.getByRole('tab', { name: 'Photos' }).click()
      await expect(page.getByText(/coming soon/i)).toHaveCount(0)

      await page.getByRole('tab', { name: 'About' }).click()
      await page.getByRole('button', { name: 'View Information Cards' }).click()
      await expect(page.getByText(/coming soon/i)).toHaveCount(0)

      await page.getByRole('button', { name: 'Back to animal details' }).click()
      await page.getByRole('button', { name: 'Back to Our Animals' }).click()
    }
  })

  test('the back button on the detail page returns to the list', async ({ page }) => {
    await openAnimalsTab(page)
    await animalCard(page, 'Goat').click()
    await expect(page.getByRole('heading', { name: 'Goat', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Back to Our Animals' }).click()
    await expect(page.locator('.animals-grid')).toBeVisible()
    await expect(page.locator('.animal-card')).toHaveCount(ANIMALS.length)
  })

  test('Photos tab shows a plain photo grid with no filter tabs or voting UI', async ({ page }) => {
    await openAnimalsTab(page)
    await animalCard(page, 'Alpaca').click()
    await page.getByRole('tab', { name: 'Photos' }).click()

    const grid = page.locator('.animal-detail-photos-grid')
    await expect(grid).toBeVisible()
    await expect(grid.locator('img')).toHaveCount(5)
    // No category filter tabs beyond the two top-level About/Photos tabs.
    await expect(page.locator('[role="tab"]')).toHaveCount(2)
    await expect(page.getByText('Swimming')).toHaveCount(0)
    await expect(page.getByText('Close-ups')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Vote/ })).toHaveCount(0)

    // About tab's content isn't still in the DOM underneath.
    await expect(page.locator('.animal-detail-facts-table')).toHaveCount(0)
  })

  test('Photos tab resolves real uploaded photos and falls back to the placeholder only for genuinely missing files', async ({
    page,
  }) => {
    await openAnimalsTab(page)

    // Capybara has all 5 real photos uploaded -- none should fall back.
    await animalCard(page, 'Capybara').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const capybaraImgs = page.locator('.animal-detail-photos-grid img')
    await expect(capybaraImgs).toHaveCount(5)
    for (let i = 0; i < 5; i++) {
      await expect(capybaraImgs.nth(i)).toHaveAttribute('src', `/animals/capybara/${i + 1}.jpg`)
    }

    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    // Goat only has photos 1-4 uploaded -- the 5th slot should fall back to
    // the placeholder SVG once the real image genuinely 404s.
    await animalCard(page, 'Goat').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const goatImgs = page.locator('.animal-detail-photos-grid img')
    await expect(goatImgs).toHaveCount(5)
    await expect(goatImgs.nth(0)).toHaveAttribute('src', '/animals/goat/1.jpg')
    await expect(goatImgs.nth(4)).toHaveAttribute('src', '/animal-photo-placeholder.svg')
  })

  test('Information Cards: text counter (not dots), cycles both directions, no Shuffle/Next button', async ({
    page,
  }) => {
    await openAnimalsTab(page)
    await animalCard(page, 'Emu').click()
    await page.getByRole('button', { name: 'View Information Cards' }).click()

    await expect(page.getByRole('heading', { name: 'Emu — Information Cards' })).toBeVisible()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(page.locator('.animal-card-nugget')).toBeVisible()

    // No dot-progress indicator, no Shuffle Cards / bottom Next Card button.
    await expect(page.locator('.animal-progress-dot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Shuffle/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next Card', exact: true })).toHaveCount(0)

    const firstTitle = await page.locator('.animal-card-nugget-title').textContent()

    await page.getByRole('button', { name: 'Next card' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 2 of 6')
    const secondTitle = await page.locator('.animal-card-nugget-title').textContent()
    expect(secondTitle).not.toBe(firstTitle)

    // Cycles forward past the last card back to the first (linear wraparound).
    await page.getByRole('button', { name: 'Next card' }).click()
    await page.getByRole('button', { name: 'Next card' }).click()
    await page.getByRole('button', { name: 'Next card' }).click()
    await page.getByRole('button', { name: 'Next card' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 6 of 6')
    await page.getByRole('button', { name: 'Next card' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')

    // Previous from the first card wraps back to the last.
    await page.getByRole('button', { name: 'Previous card' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 6 of 6')

    await page.getByRole('button', { name: 'Back to animal details' }).click()
    await expect(page.getByRole('heading', { name: 'Emu', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'View Information Cards' })).toBeVisible()
  })

  test('"Scan a QR Code" opens the existing scan-entry flow', async ({ page }) => {
    await openAnimalsTab(page)
    await page.getByRole('button', { name: 'Scan a QR Code' }).click()

    await expect(page.getByText('Scan a Code')).toBeVisible()
    await expect(page.getByLabel('Code from the sign')).toBeVisible()
  })
})
