import { test, expect, type Page } from '@playwright/test'
import { ANIMALS, PLACEHOLDER_PHOTO_SRC } from '../src/animalContent'

// Covers the "Our Animals" feature (rebranded Encyclopedia, Plan.md 2.5/5):
// the 9-animal list + name search, the individual animal detail page's
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
  test('renders all animal cards, searchable by name', async ({ page }) => {
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

  test('Information Cards: repeated cycling past a missing photo never corrupts an unrelated card\'s image', async ({
    page,
  }) => {
    // Regression test for a bug where AnimalImage's jpg->png->placeholder
    // fallback `attempt` counter never reset between cards (no `key`), so
    // once one card's image genuinely 404'd, every card cycled to
    // afterwards -- including card 1 on wraparound -- permanently inherited
    // that stale attempt count and rendered the placeholder forever, no
    // matter how many times the guest cycled through. Goat's card 5 (of 6)
    // maps to photo 5, which isn't uploaded (see the Photos-tab test above),
    // making it a real 404 rather than a simulated one.
    await openAnimalsTab(page)
    await animalCard(page, 'Goat').click()
    await page.getByRole('button', { name: 'View Information Cards' }).click()

    const img = page.locator('.animal-card-nugget-image')
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(img).toHaveAttribute('src', '/animals/goat/1.jpg')

    const next = page.getByRole('button', { name: 'Next card' })
    const prev = page.getByRole('button', { name: 'Previous card' })

    // Cycle forward through 3 full loops (18 clicks) -- passes card 5's
    // missing photo 6 times, well past the original failure mode's
    // single-cycle blind spot.
    for (let i = 0; i < 18; i++) {
      await next.click()
      const cardNum = ((i + 1) % 6) + 1
      await expect(page.locator('.animal-cards-counter')).toHaveText(`Card ${cardNum} of 6`)
      if (cardNum === 5) {
        // The missing photo: falls back to the placeholder, but only for
        // this card -- not proof of the bug by itself.
        await expect(img).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
      } else {
        const photoNum = ((cardNum - 1) % 5) + 1
        await expect(img).toHaveAttribute('src', `/animals/goat/${photoNum}.jpg`)
      }
    }

    // The real assertion: card 1's real photo still renders after extensive
    // forward cycling through the missing-photo card, not the placeholder.
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(img).toHaveAttribute('src', '/animals/goat/1.jpg')

    // Same check cycling backward through 2 full loops (12 clicks).
    for (let i = 0; i < 12; i++) {
      await prev.click()
    }
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(img).toHaveAttribute('src', '/animals/goat/1.jpg')
  })

  test('Sloth, Porcupine, and Pig show the newly added real content', async ({ page }) => {
    await openAnimalsTab(page)

    await animalCard(page, 'Sloth').click()
    await expect(page.getByRole('heading', { name: 'Sloth', exact: true })).toBeVisible()
    await expect(page.locator('.animal-detail-about-heading')).toHaveText('Meet the Sloth')
    await expect(page.locator('.animal-detail-description')).toContainText("laid-back mammals")
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Choloepus didactylus')
    await page.getByRole('button', { name: 'View Information Cards' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(page.getByText('Life in the Canopy')).toBeVisible()
    await page.getByRole('button', { name: 'Back to animal details' }).click()
    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    await animalCard(page, 'Porcupine').click()
    await expect(page.getByRole('heading', { name: 'Porcupine', exact: true })).toBeVisible()
    await expect(page.locator('.animal-detail-about-heading')).toHaveText('African Crested Porcupine')
    await expect(page.locator('.animal-detail-description')).toContainText("Don't let those quills fool you")
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Hystrix africaeaustralis')
    await page.getByRole('button', { name: 'View Information Cards' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(page.getByText("Those Aren't Hair!")).toBeVisible()
    await page.getByRole('button', { name: 'Back to animal details' }).click()
    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    await animalCard(page, 'Pig').click()
    await expect(page.getByRole('heading', { name: 'Pig', exact: true })).toBeVisible()
    await expect(page.locator('.animal-detail-about-heading')).toHaveText('Meet the Pig')
    await expect(page.locator('.animal-detail-description')).toContainText('curly tail')
    await expect(page.locator('.animal-detail-facts-table')).toContainText('Sus scrofa domesticus')
    await page.getByRole('button', { name: 'View Information Cards' }).click()
    await expect(page.locator('.animal-cards-counter')).toHaveText('Card 1 of 6')
    await expect(page.getByText('A Nose for Adventure')).toBeVisible()
  })

  test('Photo resolution reflects the real-photo drop for new and updated animals', async ({ page }) => {
    await openAnimalsTab(page)

    // Kangaroo: 2 real photos uploaded, slots 3-5 fall back to the placeholder.
    await animalCard(page, 'Kangaroo').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const kangarooImgs = page.locator('.animal-detail-photos-grid img')
    await expect(kangarooImgs).toHaveCount(5)
    await expect(kangarooImgs.nth(0)).toHaveAttribute('src', '/animals/kangaroo/1.jpg')
    await expect(kangarooImgs.nth(1)).toHaveAttribute('src', '/animals/kangaroo/2.jpg')
    await expect(kangarooImgs.nth(2)).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
    await expect(kangarooImgs.nth(4)).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
    await page.getByRole('tab', { name: 'About' }).click()
    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    // Wallaby: 4 real photos, slot 1 is a .png (jpg candidate 404s first), slot 5 falls back.
    await animalCard(page, 'Wallaby').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const wallabyImgs = page.locator('.animal-detail-photos-grid img')
    await expect(wallabyImgs).toHaveCount(5)
    await expect(wallabyImgs.nth(0)).toHaveAttribute('src', '/animals/wallaby/1.png')
    await expect(wallabyImgs.nth(1)).toHaveAttribute('src', '/animals/wallaby/2.jpg')
    await expect(wallabyImgs.nth(3)).toHaveAttribute('src', '/animals/wallaby/4.jpg')
    await expect(wallabyImgs.nth(4)).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
    await page.getByRole('tab', { name: 'About' }).click()
    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    // Sloth: all 5 real photos uploaded -- none should fall back.
    await animalCard(page, 'Sloth').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const slothImgs = page.locator('.animal-detail-photos-grid img')
    await expect(slothImgs).toHaveCount(5)
    for (let i = 0; i < 5; i++) {
      await expect(slothImgs.nth(i)).toHaveAttribute('src', `/animals/sloth/${i + 1}.jpg`)
    }
    await page.getByRole('tab', { name: 'About' }).click()
    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    // Porcupine: 4 real photos, slot 5 falls back.
    await animalCard(page, 'Porcupine').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const porcupineImgs = page.locator('.animal-detail-photos-grid img')
    await expect(porcupineImgs).toHaveCount(5)
    for (let i = 0; i < 4; i++) {
      await expect(porcupineImgs.nth(i)).toHaveAttribute('src', `/animals/porcupine/${i + 1}.jpg`)
    }
    await expect(porcupineImgs.nth(4)).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
    await page.getByRole('tab', { name: 'About' }).click()
    await page.getByRole('button', { name: 'Back to Our Animals' }).click()

    // Pig: 3 real photos, slots 4-5 fall back.
    await animalCard(page, 'Pig').click()
    await page.getByRole('tab', { name: 'Photos' }).click()
    const pigImgs = page.locator('.animal-detail-photos-grid img')
    await expect(pigImgs).toHaveCount(5)
    for (let i = 0; i < 3; i++) {
      await expect(pigImgs.nth(i)).toHaveAttribute('src', `/animals/pig/${i + 1}.jpg`)
    }
    await expect(pigImgs.nth(3)).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
    await expect(pigImgs.nth(4)).toHaveAttribute('src', PLACEHOLDER_PHOTO_SRC)
  })

  test('"Scan a QR Code" opens the existing scan-entry flow', async ({ page }) => {
    await openAnimalsTab(page)
    await page.getByRole('button', { name: 'Scan a QR Code' }).click()

    await expect(page.getByText('Scan a Code')).toBeVisible()
    await expect(page.getByLabel('Code from the sign')).toBeVisible()
  })
})
