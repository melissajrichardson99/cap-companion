import { test, expect, type Locator, type Page } from '@playwright/test'

// Covers the Scavenger Hunt: the 5-character select screen, the lock/unlock
// gate (migration 014_hunt_unlock.sql -- characters start locked and are
// unlocked by scanning/entering their QR code, see scan.spec.ts for the
// scan-resolution side of this), all 4 Challenge 2 variants (matching,
// true_false_set, image_mc, and the 2nd mc used by Pig), wrong-answer retry
// (no lockout), Challenge 3's deterministic per-character minigame launch
// (not a random draw), and progress tracking through to a character being
// marked found. Hits the real dev Supabase project via the backend, same as
// the other e2e specs -- no mocking. Tests are ordered top-to-bottom and
// each uses its own character, since hunt_progress (including unlocked_at)
// is cumulative per character across tests in this file (only reset once by
// global setup, same as every other spec). Kangaroo may already be unlocked
// by the time this file runs, since scan.spec.ts (which runs first,
// alphabetically) also scans its code -- Sloth is the one character no
// other spec ever touches, so it's used below to assert the locked state
// deterministically.
//
// The guest nav is a closed-by-default hamburger dropdown -- every
// tab/action click below opens it first via "Open menu", and tab buttons
// use the menuitemradio role (not button) per NavMenu.tsx's aria roles.

const CHARACTER_CODES: Record<string, string> = {
  Kangaroo: 'brave-otter',
  Pig: 'happy-panda',
  Capybara: 'calm-turtle',
  Snake: 'quick-falcon',
  Sloth: 'sleepy-koala',
}

function huntDialog(page: Page): Locator {
  return page.locator('.modal-panel')
}

function characterCard(page: Page, name: string): Locator {
  return page.locator('.hunt-character-card', { hasText: name })
}

async function openNavMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
}

async function openHuntTab(page: Page): Promise<void> {
  await page.goto('/')
  await openNavMenu(page)
  await page.getByRole('menuitemradio', { name: 'Scavenger Hunt' }).click()
}

// Unlocks a character via its QR code (the same code scan.spec.ts scans/
// manually enters) by deep-linking straight to /scan/:code, exactly as a
// guest's own camera app would. Confirms the guest lands straight in
// Challenge 1 as part of unlocking, per the ticket's "scanning unlocks and
// navigates straight into the first challenge" requirement.
async function unlockCharacter(page: Page, name: string): Promise<void> {
  await page.goto(`/scan/${CHARACTER_CODES[name]}`)
  await expect(page.getByText(`${name} — Challenge 1`)).toBeVisible()
}

async function openCharacter(page: Page, name: string): Promise<Locator> {
  await unlockCharacter(page, name)
  await openHuntTab(page)
  await characterCard(page, name).click()
  return huntDialog(page)
}

test.describe('Scavenger Hunt', () => {
  test('lists all 5 characters with species labels; locked characters show a scan prompt', async ({ page }) => {
    await openHuntTab(page)

    for (const name of ['Kangaroo', 'Pig', 'Capybara', 'Snake', 'Sloth']) {
      await expect(characterCard(page, name)).toBeVisible()
    }

    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-species')).toHaveText('Marsupial')
    await expect(characterCard(page, 'Capybara').locator('.hunt-character-species')).toHaveText('Rodent')
    await expect(characterCard(page, 'Sloth').locator('.hunt-character-species')).toHaveText('Animal')

    // Sloth is never scanned by any other spec, so it's a reliable
    // always-locked control for the locked-state UI.
    await expect(characterCard(page, 'Sloth').locator('.hunt-character-status')).toHaveText('Scan to unlock')
    await expect(characterCard(page, 'Sloth')).toHaveClass(/hunt-character-locked/)
  })

  test('a locked character shows a scan prompt instead of its challenges, and does not unlock on its own', async ({
    page,
  }) => {
    await openHuntTab(page)
    await characterCard(page, 'Sloth').click()

    const prompt = page.locator('.modal-panel')
    await expect(prompt.getByText('Sloth is locked')).toBeVisible()
    await expect(prompt.getByText(/scan its qr code/i)).toBeVisible()
    // No challenge content leaked into this prompt.
    await expect(prompt.getByText(/Challenge 1/)).toHaveCount(0)

    await prompt.getByRole('button', { name: 'Not Yet' }).click()
    await expect(prompt).toHaveCount(0)
    // Still locked -- dismissing the prompt isn't itself an unlock.
    await expect(characterCard(page, 'Sloth').locator('.hunt-character-status')).toHaveText('Scan to unlock')
  })

  test('the scan prompt\'s "Scan Now" button opens the scan-entry modal', async ({ page }) => {
    await openHuntTab(page)
    await characterCard(page, 'Sloth').click()
    await page.locator('.modal-panel').getByRole('button', { name: 'Scan Now' }).click()

    await expect(page.getByText('Scan a Code')).toBeVisible()
    await expect(page.getByLabel('Code from the sign')).toBeVisible()
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

  test('re-scanning an already-unlocked (and fully completed) character just navigates back in, no error', async ({
    page,
  }) => {
    // Kangaroo was already unlocked AND fully completed (all 3 challenges)
    // by the earlier "Kangaroo: mc -> matching -> minigame" test in this
    // file. Re-scanning it must not error, re-lock it, or reset its
    // progress -- just land back on the same "found" state.
    await page.goto(`/scan/${CHARACTER_CODES.Kangaroo}`)

    await expect(page.getByText('You found Kangaroo! All 3 challenges complete.')).toBeVisible()
    await expect(page.locator('.screen-error')).toHaveCount(0)

    await openHuntTab(page)
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('Found! ✓')
    await expect(characterCard(page, 'Kangaroo')).not.toHaveClass(/hunt-character-locked/)
  })
})
