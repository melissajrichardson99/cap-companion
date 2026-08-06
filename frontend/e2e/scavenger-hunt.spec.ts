import { test, expect, type Locator, type Page } from '@playwright/test'

// Covers the Scavenger Hunt: the 5-character select screen, all 4 Challenge 2
// variants (matching, true_false_set, image_mc, and the 2nd mc used by Pig),
// wrong-answer retry (no lockout), Challenge 3's deterministic per-character
// minigame launch (not a random draw), and progress tracking through to a
// character being marked found. Hits the real dev Supabase project via the
// backend, same as the other e2e specs -- no mocking. Tests are ordered
// top-to-bottom and each uses its own character, since hunt_progress is
// cumulative per character across tests in this file (only reset once by
// global setup, same as every other spec).

function huntDialog(page: Page): Locator {
  return page.locator('.modal-panel')
}

function characterCard(page: Page, name: string): Locator {
  return page.locator('.hunt-character-card', { hasText: name })
}

async function openCharacter(page: Page, name: string): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Scavenger Hunt' }).click()
  await characterCard(page, name).click()
  return huntDialog(page)
}

test.describe('Scavenger Hunt', () => {
  test('lists all 5 characters with species labels and 0/3 status', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Scavenger Hunt' }).click()

    for (const name of ['Kangaroo', 'Pig', 'Capybara', 'Snake', 'Sloth']) {
      await expect(characterCard(page, name)).toBeVisible()
    }

    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-species')).toHaveText('Marsupial')
    await expect(characterCard(page, 'Capybara').locator('.hunt-character-species')).toHaveText('Rodent')
    await expect(characterCard(page, 'Sloth').locator('.hunt-character-species')).toHaveText('Animal')
    await expect(characterCard(page, 'Sloth').locator('.hunt-character-status')).toHaveText('0/3 challenges')
  })

  test('Kangaroo: mc -> matching -> minigame, completing the character end to end', async ({ page }) => {
    const dialog = await openCharacter(page, 'Kangaroo')
    await expect(dialog.getByText('Kangaroo — Challenge 1')).toBeVisible()

    // Wrong mc answer: no lockout, no advance.
    await dialog.getByRole('button', { name: 'A pack', exact: true }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await expect(dialog.getByText('Kangaroo — Challenge 1')).toBeVisible()

    await dialog.getByRole('button', { name: 'A mob', exact: true }).click()
    await expect(dialog.getByText('Kangaroo — Challenge 2')).toBeVisible()
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('1/3 challenges')

    // 5-pair matching: click a left term, then its matching right meaning.
    const pairs: [string, string][] = [
      ['Joey', 'a baby kangaroo'],
      ['Pouch', 'where a joey grows'],
      ['Marsupial', 'the mammal group kangaroos belong to'],
      ['Mob', 'a group of kangaroos'],
      ['Boomer', 'a large male kangaroo'],
    ]
    // Mismatch first, to prove a wrong pair doesn't lock either side.
    await dialog.getByRole('button', { name: 'Joey', exact: true }).click()
    await dialog.getByRole('button', { name: 'a large male kangaroo', exact: true }).click()
    await expect(dialog.getByText('Not a match — try again.')).toBeVisible()

    for (const [left, right] of pairs) {
      await dialog.getByRole('button', { name: left, exact: true }).click()
      await dialog.getByRole('button', { name: right, exact: true }).click()
    }

    await expect(dialog.getByText('Kangaroo — Challenge 3')).toBeVisible()
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('2/3 challenges')

    await dialog.getByRole('button', { name: 'Play Now' }).click()

    const overlay = page.locator('.minigame-overlay-panel')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('iframe')).toHaveAttribute('src', '/games/mini_platformer/index.html')

    const iframeHandle = await page.locator('.minigame-overlay-frame').elementHandle()
    const frame = await iframeHandle?.contentFrame()
    await frame?.evaluate(() => window.parent.postMessage({ type: 'minigame-complete' }, '*'))

    await expect(page.locator('.minigame-overlay')).toHaveCount(0)
    await expect(dialog.getByText('You found Kangaroo! All 3 challenges complete.')).toBeVisible()

    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('Found! ✓')
  })

  test('Pig: two mc challenges in a row, wrong answers retry without advancing', async ({ page }) => {
    const dialog = await openCharacter(page, 'Pig')
    await expect(dialog.getByText('Pig — Challenge 1')).toBeVisible()

    await dialog.getByRole('button', { name: 'Panting like a dog', exact: true }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Rolling in mud', exact: true }).click()

    await expect(dialog.getByText('Pig — Challenge 2')).toBeVisible()
    await dialog.getByRole('button', { name: 'Goldfish', exact: true }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Dolphins and primates', exact: true }).click()

    await expect(dialog.getByText('Pig — Challenge 3')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Play Now' })).toBeVisible()
    await expect(characterCard(page, 'Pig').locator('.hunt-character-status')).toHaveText('2/3 challenges')
  })

  test('Capybara: park-verified mc + a one-at-a-time true/false set of 3', async ({ page }) => {
    const dialog = await openCharacter(page, 'Capybara')
    await dialog.getByRole('button', { name: 'A herd', exact: true }).click()

    await expect(dialog.getByText('Capybara — Challenge 2')).toBeVisible()
    await expect(dialog.getByText('Statement 1 of 3')).toBeVisible()
    await expect(dialog.getByText('Capybaras can stay underwater up to five minutes')).toBeVisible()

    // Wrong answer on statement 1: stays on statement 1.
    await dialog.getByRole('button', { name: 'False', exact: true }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await expect(dialog.getByText('Statement 1 of 3')).toBeVisible()

    await dialog.getByRole('button', { name: 'True', exact: true }).click()
    await expect(dialog.getByText('Statement 2 of 3')).toBeVisible()
    await expect(dialog.getByText('Capybaras are the smallest rodent in the world')).toBeVisible()
    await dialog.getByRole('button', { name: 'False', exact: true }).click()

    await expect(dialog.getByText('Statement 3 of 3')).toBeVisible()
    await expect(dialog.getByText('Capybaras are native to Central and South America')).toBeVisible()
    await dialog.getByRole('button', { name: 'True', exact: true }).click()

    await expect(dialog.getByText('Capybara — Challenge 3')).toBeVisible()
  })

  test('Snake: mc, then an unscramble-to-word step gating a follow-up mc', async ({ page }) => {
    const dialog = await openCharacter(page, 'Snake')
    await dialog.getByRole('button', { name: 'By smelling with their tongue', exact: true }).click()

    await expect(dialog.getByText('Snake — Challenge 2')).toBeVisible()
    await expect(dialog.getByText('CSLAE')).toBeVisible()
    await expect(dialog.getByLabel('Close-up photo of snake scale texture')).toBeVisible()

    const input = dialog.getByLabel('Unscrambled word')
    await input.fill('APPLE')
    await dialog.getByRole('button', { name: 'Submit' }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    // Still on the unscramble step -- the mc question must not be showing yet.
    await expect(dialog.getByText("What covers a snake's body?")).toHaveCount(0)

    await input.fill('scale') // lowercase, to confirm the check is case-insensitive
    await dialog.getByRole('button', { name: 'Submit' }).click()

    await expect(dialog.getByText("What covers a snake's body?")).toBeVisible()
    await dialog.getByRole('button', { name: 'Fur', exact: true }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Scale', exact: true }).click()

    await expect(dialog.getByText('Snake — Challenge 3')).toBeVisible()
  })
})
