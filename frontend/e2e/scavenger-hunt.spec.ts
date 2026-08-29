import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedDeviceSession } from './deviceSessionHelper'

// Covers the Scavenger Hunt: the 5-character select screen, the lock/unlock
// gate (migration 014_hunt_unlock.sql -- characters start locked and are
// unlocked by scanning/entering their QR code, see scan.spec.ts for the
// scan-resolution side of this), all 4 Challenge 2 variants (matching,
// true_false_set, image_mc, and the 2nd mc used by Pig), wrong-answer retry
// (no lockout), Challenge 3's deterministic per-character minigame launch
// (not a random draw), progress tracking through to a character being
// marked found, and the redesign's per-character accent theming + fully
// anonymous locked state + overall progress indicator. Hits the real dev
// Supabase project via the backend, same as the other e2e specs -- no
// mocking.
//
// Per-Device Sessions Phase 6b (migration 030, final phase): hunt_progress is
// now one row per (session, character) pair, not one global row per
// character -- see hunt-sessions.spec.ts for coverage of what that actually
// changes (two-session isolation, coin-bonus attribution, the QR deep-link
// session-establishment path). This file's own tests still want one
// continuous "guest visit" spanning every test below (tests are ordered
// top-to-bottom and each uses its own character, since progress accumulates
// per character across tests in this file), so every test explicitly seeds
// the SAME device-session token (SESSION_TOKEN below) via beforeEach --
// without that, Playwright's default fresh-context-per-test would otherwise
// hand each test its own independent (and independently-locked) 5-character
// roster, same as any other two unrelated guests. Kangaroo/Pig/Capybara
// being already unlocked by the time some tests below run is purely this
// file's own earlier tests acting within that one shared session -- no
// dependency on scan.spec.ts or any other file anymore, since a different
// spec file's session token can never see or affect this one's Hunt
// progress.
//
// The guest nav is a closed-by-default hamburger dropdown -- every
// tab/action click below opens it first via "Open menu", and tab buttons
// use the menuitemradio role (not button) per NavMenu.tsx's aria roles.

const SESSION_TOKEN = crypto.randomUUID()

test.beforeEach(async ({ page }) => {
  await seedDeviceSession(page, SESSION_TOKEN)
})

const CHARACTER_CODES: Record<string, string> = {
  Kangaroo: 'brave-otter',
  Pig: 'happy-panda',
  Capybara: 'calm-turtle',
  Snake: 'quick-falcon',
  Sloth: 'sleepy-koala',
}

const CHARACTER_SLUGS: Record<string, string> = {
  Kangaroo: 'kangaroo',
  Pig: 'pig',
  Capybara: 'capybara',
  Snake: 'snake',
  Sloth: 'sloth',
}

function huntDialog(page: Page): Locator {
  return page.locator('.modal-panel')
}

// Targets a specific character's card via its data-hunt-character attribute
// (always present, locked or not) rather than its name text -- a locked
// card never renders its name, so name-text matching can't find it.
function characterCard(page: Page, name: string): Locator {
  return page.locator(`.hunt-character-card[data-hunt-character="${CHARACTER_SLUGS[name]}"]`)
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
// guest's own camera app would. A fresh (never-before-unlocked) scan lands
// on the "character found" popup first -- this dismisses it via "Start
// Challenges" when present, then confirms the guest lands in Challenge 1
// either way. That makes this helper work the same whether this is this
// character's first-ever unlock in the whole suite or a re-scan of one
// scan.spec.ts already unlocked (order-dependent per the file header above).
async function unlockCharacter(page: Page, name: string): Promise<void> {
  await page.goto(`/scan/${CHARACTER_CODES[name]}`)
  const startButton = page.getByRole('button', { name: 'Start Challenges' })
  const challengeHeading = page.getByText(`${name} — Challenge 1`)
  // .catch(() => {}) on each race branch: whichever one loses the race stays
  // pending and would otherwise reject (element never appears) after the
  // test's already moved on, producing an unhandled rejection -- attaching a
  // handler up front makes that safe regardless of which branch wins.
  await Promise.race([
    startButton.waitFor({ state: 'visible' }).catch(() => {}),
    challengeHeading.waitFor({ state: 'visible' }).catch(() => {}),
  ])
  if (await startButton.isVisible()) {
    await startButton.click()
  }
  await expect(challengeHeading).toBeVisible()
}

async function openCharacter(page: Page, name: string): Promise<Locator> {
  await unlockCharacter(page, name)
  await openHuntTab(page)
  await characterCard(page, name).click()
  return huntDialog(page)
}

test.describe('Scavenger Hunt', () => {
  test('renders all 5 character cards; a never-scanned character stays fully anonymous', async ({ page }) => {
    await openHuntTab(page)

    await expect(page.locator('.hunt-character-card')).toHaveCount(5)

    // Sloth is never scanned by any other test in this file's shared
    // session, so it's a reliable always-locked control for the locked-state
    // UI (and, being per-session now, no other spec file's session could
    // affect it either way).
    const sloth = characterCard(page, 'Sloth')
    await expect(sloth).toHaveClass(/hunt-character-locked/)
    await expect(sloth).toContainText('???')
    await expect(sloth).toContainText('Locked')
    // No identifying info leaked onto a locked card.
    await expect(sloth).not.toContainText('Sloth')
    await expect(sloth.locator('.hunt-character-species')).toHaveCount(0)
    await expect(sloth.locator('.hunt-character-name')).toHaveCount(0)
  })

  test('the overall progress bar tracks the total of 5 and shows a Scan QR Code CTA', async ({ page }) => {
    await openHuntTab(page)
    const bar = page.locator('.hunt-overall-progress-track')
    await expect(bar).toHaveAttribute('aria-valuemin', '0')
    await expect(bar).toHaveAttribute('aria-valuemax', '5')
    await expect(page.getByRole('button', { name: 'Scan QR Code' })).toBeVisible()
  })

  test('the Scan QR Code button opens the scan-entry modal', async ({ page }) => {
    await openHuntTab(page)
    await page.getByRole('button', { name: 'Scan QR Code' }).click()

    await expect(page.getByText('Scan a Code')).toBeVisible()
    await expect(page.getByLabel("What's on the sign")).toBeVisible()
  })

  test('tapping a locked character shows a location hint, not its identity', async ({ page }) => {
    await openHuntTab(page)
    await characterCard(page, 'Sloth').click()

    const prompt = page.locator('.modal-panel')
    await expect(prompt.getByText("Something's Hiding Here")).toBeVisible()
    await expect(prompt.getByText(/Somewhere near/)).toBeVisible()
    // No identity or challenge content leaked into this prompt.
    await expect(prompt.getByText('Sloth', { exact: true })).toHaveCount(0)
    await expect(prompt.getByText(/Challenge 1/)).toHaveCount(0)

    await prompt.getByRole('button', { name: 'Not Yet' }).click()
    await expect(prompt).toHaveCount(0)
    // Still locked -- dismissing the prompt isn't itself an unlock.
    await expect(characterCard(page, 'Sloth')).toHaveClass(/hunt-character-locked/)
  })

  test('the hint prompt\'s "Scan Now" button opens the scan-entry modal', async ({ page }) => {
    await openHuntTab(page)
    await characterCard(page, 'Sloth').click()
    await page.locator('.modal-panel').getByRole('button', { name: 'Scan Now' }).click()

    await expect(page.getByText('Scan a Code')).toBeVisible()
    await expect(page.getByLabel("What's on the sign")).toBeVisible()
  })

  test('a fresh scan shows the "character found" popup before any challenge starts, and moves the overall progress bar', async ({
    page,
  }) => {
    // Snake is untouched by every other spec, so this scan is guaranteed
    // fresh regardless of run order.
    await openHuntTab(page)
    const bar = page.locator('.hunt-overall-progress-track')
    const before = Number(await bar.getAttribute('aria-valuenow'))

    await page.goto(`/scan/${CHARACTER_CODES.Snake}`)

    await expect(page.getByText('You found')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Snake' })).toBeVisible()
    const startButton = page.getByRole('button', { name: 'Start Challenges' })
    await expect(startButton).toBeVisible()
    // Challenge content hasn't started yet -- the popup gates it.
    await expect(page.getByText('Snake — Challenge 1')).toHaveCount(0)

    await startButton.click()
    await expect(page.getByText('Snake — Challenge 1')).toBeVisible()

    await openHuntTab(page)
    await expect(bar).toHaveAttribute('aria-valuenow', String(before + 1))

    // Re-scanning the same (now-unlocked) character skips the popup.
    await page.goto(`/scan/${CHARACTER_CODES.Snake}`)
    await expect(page.getByText('Snake — Challenge 1')).toBeVisible()
    await expect(page.getByText('You found')).toHaveCount(0)
  })

  test('unlocked characters render themed, with distinct accent colors per character', async ({ page }) => {
    await unlockCharacter(page, 'Kangaroo')
    await unlockCharacter(page, 'Capybara')
    await openHuntTab(page)

    const kangaroo = characterCard(page, 'Kangaroo')
    const capybara = characterCard(page, 'Capybara')
    await expect(kangaroo).not.toHaveClass(/hunt-character-locked/)
    await expect(kangaroo.locator('.hunt-character-name')).toHaveText('Kangaroo')
    await expect(kangaroo.locator('.hunt-character-species')).toHaveText('Marsupial')
    await expect(capybara.locator('.hunt-character-species')).toHaveText('Rodent')

    const kangarooColor = await kangaroo.evaluate((el) => getComputedStyle(el).borderColor)
    const capybaraColor = await capybara.evaluate((el) => getComputedStyle(el).borderColor)
    const lockedColor = await characterCard(page, 'Sloth').evaluate((el) => getComputedStyle(el).borderColor)
    expect(kangarooColor).not.toBe(capybaraColor)
    expect(kangarooColor).not.toBe(lockedColor)
    expect(capybaraColor).not.toBe(lockedColor)
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
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('1/3 challenges completed')

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
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('2/3 challenges completed')

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

    const wrongTapped = dialog.getByRole('button', { name: 'Panting like a dog', exact: true })
    const untapped = dialog.getByRole('button', { name: 'Hiding in shade only', exact: true })
    await wrongTapped.click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    // The tapped (wrong) option's border visually differs from an untapped
    // one -- same shared .hunt-option-wrong class the True/False buttons use
    // (verified with an exact color match in the Capybara test above), and
    // this was silently losing to shared.css's plain .btn border before the
    // .hunt-modal-inner specificity fix.
    expect(await wrongTapped.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(
      await untapped.evaluate((el) => getComputedStyle(el).borderColor),
    )
    await dialog.getByRole('button', { name: 'Rolling in mud', exact: true }).click()

    await expect(dialog.getByText('Pig — Challenge 2')).toBeVisible()
    await dialog.getByRole('button', { name: 'Goldfish', exact: true }).click()
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Dolphins and primates', exact: true }).click()

    await expect(dialog.getByText('Pig — Challenge 3')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Play Now' })).toBeVisible()
    await expect(characterCard(page, 'Pig').locator('.hunt-character-status')).toHaveText('2/3 challenges completed')
  })

  test('Capybara: park-verified mc + a one-at-a-time true/false set of 3 (answered directly from the /scan/:code screen)', async ({
    page,
  }) => {
    // Stays on the /scan/:code screen throughout (never switches to the Hunt
    // tab) -- this is the actual guest path (camera app -> printed sign's
    // URL) and the one ScanScreen.tsx's own local `state.character` snapshot
    // bug made get stuck re-showing Challenge 1 forever regardless of answer
    // correctness, since HuntChallengeModal there never saw progress
    // updates. The Hunt-tab path (openCharacter, used by the Kangaroo test
    // below) reads reactively from the shared characters list and was never
    // affected, which is why this distinct path needs its own coverage.
    await unlockCharacter(page, 'Capybara')
    const dialog = huntDialog(page)
    await dialog.getByRole('button', { name: 'A herd', exact: true }).click()

    await expect(dialog.getByText('Capybara — Challenge 2')).toBeVisible()
    await expect(dialog.getByText('Statement 1 of 3')).toBeVisible()
    await expect(dialog.getByText('Capybaras can stay underwater up to five minutes')).toBeVisible()

    // True/False buttons carry the character's accent as their idle color
    // (a real applied style, not just a stylesheet rule) -- matches the
    // per-character theming already proven on the character cards, extended
    // here to a challenge-screen button type that was left unthemed.
    const trueButton = dialog.getByRole('button', { name: 'True', exact: true })
    const falseButton = dialog.getByRole('button', { name: 'False', exact: true })
    const trueButtonBg = await trueButton.evaluate((el) => getComputedStyle(el).backgroundColor)
    // Resolves Capybara's --hunt-accent to a real RGB color via a throwaway
    // probe element (inherits the variable from the same [data-hunt-character]
    // subtree), so this compares actual rendered colors rather than raw
    // (possibly still-unresolved) custom-property text.
    const expectedAccentRgb = await dialog.locator('[data-hunt-character]').evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--hunt-accent)'
      el.appendChild(probe)
      const rgb = getComputedStyle(probe).color
      probe.remove()
      return rgb
    })
    expect(trueButtonBg).toBe(expectedAccentRgb)
    await expect(trueButton).not.toHaveClass(/hunt-option-(correct|wrong)/)

    // Wrong answer on statement 1: stays on statement 1, and the tapped
    // (wrong) option highlights red.
    await falseButton.click()
    await expect(falseButton).toHaveClass(/hunt-option-wrong/)
    await expect(dialog.getByText('Not quite — try again.')).toBeVisible()
    await expect(dialog.getByText('Statement 1 of 3')).toBeVisible()

    // Correct answer: the tapped option highlights green (briefly, before
    // auto-advancing to the next statement).
    await trueButton.click()
    await expect(trueButton).toHaveClass(/hunt-option-correct/)
    await expect(dialog.getByText('Statement 2 of 3')).toBeVisible()
    await expect(dialog.getByText('Capybaras are the smallest rodent in the world')).toBeVisible()
    await dialog.getByRole('button', { name: 'False', exact: true }).click()

    await expect(dialog.getByText('Statement 3 of 3')).toBeVisible()
    await expect(dialog.getByText('Capybaras are native to Central and South America')).toBeVisible()
    await dialog.getByRole('button', { name: 'True', exact: true }).click()

    await expect(dialog.getByText('Capybara — Challenge 3')).toBeVisible()
  })

  test('Snake: mc, then an unscramble-to-word step gating a follow-up mc (answered directly from the /scan/:code screen)', async ({
    page,
  }) => {
    // Same rationale as the Capybara test above -- stays on /scan/:code
    // throughout instead of switching to the Hunt tab, exercising the path
    // that was silently broken by ScanScreen.tsx's stale local snapshot.
    await unlockCharacter(page, 'Snake')
    const dialog = huntDialog(page)
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
    // file. Re-scanning it must not error, re-lock it, reset its progress,
    // or show the found popup again -- just land back on the same "found"
    // state.
    await page.goto(`/scan/${CHARACTER_CODES.Kangaroo}`)

    await expect(page.getByText('You found Kangaroo! All 3 challenges complete.')).toBeVisible()
    await expect(page.locator('.screen-error')).toHaveCount(0)

    await openHuntTab(page)
    await expect(characterCard(page, 'Kangaroo').locator('.hunt-character-status')).toHaveText('Found! ✓')
    await expect(characterCard(page, 'Kangaroo')).not.toHaveClass(/hunt-character-locked/)
  })
})
