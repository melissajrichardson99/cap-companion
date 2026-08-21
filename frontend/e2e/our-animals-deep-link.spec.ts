import { test, expect } from '@playwright/test'
import { ANIMALS } from '../src/animalContent'

// Covers the /animals/:slug direct deep link (QR signage at each enclosure),
// added alongside backend/scripts/generate_animal_qr_codes.py. Deliberately a
// separate URL scheme from the Scavenger Hunt's /scan/:code (see App.tsx and
// app/services/qr.py) -- 4 animals (Capybara, Kangaroo, Sloth, Pig) are also
// Hunt characters, so this suite specifically checks the two never interact.
//
// Named to sort right before our-animals.spec.ts (and well after
// cobb-coins.spec.ts, which must stay first -- see
// cap-companion-e2e-alphabetical-ordering-gotcha) and before scan.spec.ts, so
// it runs against a still-all-locked Hunt state.
//
// Our Animals content (animalContent.ts) is a static frontend constant with
// no live/mutable store -- unlike the Hunt's /scan/:code -> ScanScreen path,
// which had a real stale-snapshot regression (see
// cap-companion-scan-screen-stale-snapshot-gotcha), there's no separate
// fetched copy for a deep link to go stale against here. The "same live data
// as list-browsing" test below is the closest meaningful equivalent check for
// this feature: the deep-link path must render the exact same content as the
// in-app list->detail path, not some other/frozen source.

test.describe('/animals/:slug direct deep link', () => {
  test('landing directly on each of the 9 animals via /animals/:slug shows that animal, bypassing the list', async ({
    page,
  }) => {
    for (const animal of ANIMALS) {
      await page.goto(`/animals/${animal.slug}`)
      await expect(page.getByRole('heading', { name: animal.name, exact: true })).toBeVisible()
      await expect(page.locator('.animal-detail-about-heading')).toHaveText(animal.aboutHeading)
      // Landed straight on the detail screen -- the list grid never rendered.
      await expect(page.locator('.animals-grid')).toHaveCount(0)
    }
  })

  test('deep link renders the same live content as browsing there from the list (not a stale/different copy)', async ({
    page,
  }) => {
    await page.goto('/animals/capybara')
    await expect(page.getByRole('heading', { name: 'Capybara', exact: true })).toBeVisible()
    const deepLinkDescription = await page.locator('.animal-detail-description').textContent()
    const deepLinkFacts = await page.locator('.animal-detail-facts-table').textContent()

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
    await page.locator('.animal-card', { hasText: 'Capybara' }).click()
    await expect(page.getByRole('heading', { name: 'Capybara', exact: true })).toBeVisible()
    const browsedDescription = await page.locator('.animal-detail-description').textContent()
    const browsedFacts = await page.locator('.animal-detail-facts-table').textContent()

    expect(deepLinkDescription).toBe(browsedDescription)
    expect(deepLinkFacts).toBe(browsedFacts)
  })

  test('an unknown slug shows a clear error state, not a crash or blank screen', async ({ page }) => {
    await page.goto('/animals/does-not-exist')

    await expect(page.getByText(/couldn't find that animal/i)).toBeVisible()
    await expect(page.locator('.animal-card')).toHaveCount(0)

    await page.getByRole('button', { name: 'Browse Our Animals' }).click()
    await expect(page.locator('.animal-card')).toHaveCount(ANIMALS.length)
  })

  test('back button from a deep link returns to the full list, and leaving/returning to the tab does not re-land on the animal', async ({
    page,
  }) => {
    await page.goto('/animals/goat')
    await expect(page.getByRole('heading', { name: 'Goat', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Back to Our Animals' }).click()
    await expect(page.locator('.animal-card')).toHaveCount(ANIMALS.length)

    // Switch away and back to the Our Animals tab -- should show the list,
    // not bounce back to Goat (the deep-link slug must only apply once).
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Map' }).click()
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Our Animals' }).click()
    await expect(page.locator('.animals-grid')).toBeVisible()
    await expect(page.locator('.animal-card')).toHaveCount(ANIMALS.length)
  })

  test('does not interact with the Scavenger Hunt /scan/:code flow for an overlapping animal name', async ({
    page,
  }) => {
    // Capybara is both an Our Animals entry and a Hunt character. A locked
    // Hunt card deliberately hides the character's name behind "???" (the
    // mystery mechanic, HuntScreen.tsx), so it's located by its stable
    // data-hunt-character attribute rather than visible text. Confirm it
    // starts locked, that visiting its Our Animals deep link has no effect
    // on that Hunt state, and that /scan/:code is unaffected.
    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Scavenger Hunt' }).click()
    const capybaraCard = page.locator('[data-hunt-character="capybara"]')
    await expect(capybaraCard).toHaveClass(/hunt-character-locked/)

    await page.goto('/animals/capybara')
    await expect(page.getByRole('heading', { name: 'Capybara', exact: true })).toBeVisible()
    await expect(page.getByText('Coming soon!')).toHaveCount(0)

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Scavenger Hunt' }).click()
    await expect(capybaraCard).toHaveClass(/hunt-character-locked/)

    // /scan/:code still resolves to its own, entirely separate flow.
    await page.goto('/scan/nonexistent-code')
    await expect(page.getByText(/couldn't find a code matching/i)).toBeVisible()
  })
})
