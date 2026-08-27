import { test, expect, type Page } from '@playwright/test'
import { seedDeviceSession } from './deviceSessionHelper'

// Covers QR/manual-code scanning (migration 009_scan_codes.sql) and the
// Scavenger Hunt lock/unlock gate built on top of it (migration
// 014_hunt_unlock.sql): manual code entry and a mocked camera decode both
// unlocking a hunt_character and (on a genuinely fresh unlock) showing the
// "character found" popup before routing into Challenge 1, resolving an
// encyclopedia_entry code, an unknown code showing a clear "not found"
// state, re-scanning an already-unlocked character being a silent no-op
// (not an error, a re-lock, or a repeated found popup), and /scan/:code
// working as a hard direct deep link (page.goto straight to the URL,
// simulating someone else's camera app opening it fresh rather than in-app
// navigation).
//
// Per-Device Sessions Phase 6b (migration 030, final phase): Hunt progress
// (including unlocked_at) is now scoped per device session, not global --
// see hunt-sessions.spec.ts for the dedicated two-session-isolation and
// fresh-deep-link-session coverage that change enables. This file's own
// tests still want one continuous "guest visit" across every test below
// (several build on an earlier test's unlock, e.g. the case-insensitive
// re-scan test), so every test explicitly seeds the SAME device-session
// token (SESSION_TOKEN below) via beforeEach -- without that, Playwright's
// default fresh-context-per-test would otherwise hand each test its own
// independent, independently-locked roster. This also means this file no
// longer shares any Hunt state with scavenger-hunt.spec.ts's own session
// (each file uses its own SESSION_TOKEN) or needs to run in any particular
// order relative to it -- unlocking Kangaroo here has no effect on any other
// file's session.
//
// Deliberately never answers/advances a Hunt challenge past Challenge 1
// here -- only asserts the modal opened on the right character.
//
// The guest nav is a closed-by-default hamburger dropdown -- "Scan QR"
// lives inside it, so every test opens it first via "Open menu".

const SESSION_TOKEN = crypto.randomUUID()

test.beforeEach(async ({ page }) => {
  await seedDeviceSession(page, SESSION_TOKEN)
})

async function openScanEntry(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Scan QR' }).click()
}

// A fresh (never-before-unlocked) scan now lands on the "character found"
// popup before Challenge 1 (see ScanScreen.tsx's wasLocked check) -- this
// dismisses it via "Start Challenges" when present, then no-ops if the scan
// was actually a re-scan of an already-unlocked character (which skips the
// popup and lands straight on Challenge 1, unchanged from before).
async function dismissFoundPopupIfPresent(page: Page, name: string): Promise<void> {
  const startButton = page.getByRole('button', { name: 'Start Challenges' })
  const challengeHeading = page.getByText(`${name} — Challenge 1`)
  await Promise.race([
    startButton.waitFor({ state: 'visible' }).catch(() => {}),
    challengeHeading.waitFor({ state: 'visible' }).catch(() => {}),
  ])
  if (await startButton.isVisible()) {
    await startButton.click()
  }
}

test.describe('QR / manual code scanning', () => {
  test('manual entry unlocks a hunt_character code and routes into its first challenge', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Code from the sign').fill('brave-otter')
    await modal.getByRole('button', { name: 'Go' }).click()

    // This is Kangaroo's first-ever scan in the suite (this file runs
    // alphabetically first), so it lands on the "character found" popup
    // before Challenge 1.
    await expect(page.getByText('You found')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kangaroo' })).toBeVisible()
    await page.getByRole('button', { name: 'Start Challenges' }).click()

    await expect(page.getByText('Kangaroo — Challenge 1')).toBeVisible()
    await expect(page).toHaveURL(/\/scan\/brave-otter$/)

    // The unlock persists -- Kangaroo shows unlocked (not "Scan to unlock")
    // back on the Scavenger Hunt tab.
    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Scavenger Hunt' }).click()
    const kangarooCard = page.locator('.hunt-character-card', { hasText: 'Kangaroo' })
    await expect(kangarooCard).not.toHaveClass(/hunt-character-locked/)
  })

  test('manual entry is case-insensitive and whitespace-tolerant', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Code from the sign').fill('  Brave Otter  ')
    await modal.getByRole('button', { name: 'Go' }).click()

    // Kangaroo is already unlocked by the previous test, so this is a
    // re-scan -- straight to Challenge 1, no found popup.
    await dismissFoundPopupIfPresent(page, 'Kangaroo')
    await expect(page.getByText('Kangaroo — Challenge 1')).toBeVisible()
  })

  test('re-scanning an already-unlocked character is a silent no-op, not an error', async ({ page }) => {
    // Scan it once, then again -- both via the direct deep-link path, same
    // as a guest re-scanning the same sign with their phone's camera app.
    // Kangaroo is already unlocked by earlier tests in this file, so
    // neither scan should show the found popup.
    await page.goto('/scan/brave-otter')
    await expect(page.getByText('Kangaroo — Challenge 1')).toBeVisible()
    await expect(page.getByText('You found')).toHaveCount(0)

    await page.goto('/scan/brave-otter')
    await expect(page.getByText('Kangaroo — Challenge 1')).toBeVisible()
    await expect(page.locator('.screen-error')).toHaveCount(0)
    await expect(page.getByText('You found')).toHaveCount(0)
  })

  test('camera scan (mocked decode) unlocks a hunt_character the same way manual entry does', async ({ page }) => {
    // Playwright can't show a physical QR code to a real camera -- stub
    // getUserMedia to hand back a real (blank) MediaStream via
    // canvas.captureStream(), and BarcodeDetector to return a canned decode
    // result immediately, matching ScanEntryModal's actual detection path
    // (it prefers BarcodeDetector when present, only falling back to jsQR
    // otherwise). Installed via addInitScript so it's in place before the
    // page's own scripts run and feature-detect 'BarcodeDetector' in window.
    await page.addInitScript(() => {
      class FakeBarcodeDetector {
        async detect() {
          return [{ rawValue: 'https://cap-companion.example/scan/happy-panda' }]
        }
      }
      // @ts-expect-error test-only global stub
      window.BarcodeDetector = FakeBarcodeDetector
      // @ts-expect-error test-only global stub
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 10
        // A never-painted canvas produces a MediaStream whose video track
        // never actually delivers frame data in headless Chromium -- even
        // with a fixed captureStream(fps) rate -- so the <video> element's
        // play() hangs forever waiting for loadedmetadata. Paint one frame
        // first so the stream has real pixel data to capture.
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'green'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(10)
      }
    })

    await openScanEntry(page)

    // Pig's first-ever scan in the suite -- found popup before Challenge 1.
    await expect(page.getByText('You found')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pig' })).toBeVisible()
    await page.getByRole('button', { name: 'Start Challenges' }).click()

    await expect(page.getByText('Pig — Challenge 1')).toBeVisible()
    await expect(page).toHaveURL(/\/scan\/happy-panda$/)
  })

  test('manual entry resolves an encyclopedia_entry code into the "coming soon" stub', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Code from the sign').fill('jolly-zebra')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByRole('heading', { name: 'Red Panda' })).toBeVisible()
    await expect(page.getByText('Coming soon!')).toBeVisible()
  })

  test('an unknown code shows a clear not-found state, not a broken page', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Code from the sign').fill('totally-bogus-code')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByText(/couldn't find a code matching/i)).toBeVisible()
    await page.getByRole('button', { name: 'Back to the app' }).click()
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('button', { name: 'Scan QR' })).toBeVisible()
  })

  test('/scan/:code works as a direct deep link, not just in-app navigation', async ({ page }) => {
    // A fresh page.goto (no prior in-app navigation) simulates a phone's own
    // camera app opening the printed sign's URL directly.
    await page.goto('/scan/lucky-giraffe')

    await expect(page.getByRole('heading', { name: 'Otter' })).toBeVisible()
    await expect(page.getByText('Coming soon!')).toBeVisible()

    await page.getByRole('button', { name: 'Back to the app' }).click()
    await expect(page).toHaveURL('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('button', { name: 'Scan QR' })).toBeVisible()
  })

  test('/scan/:code deep link for a hunt_character unlocks it directly, same as camera app -> app', async ({
    page,
  }) => {
    await page.goto('/scan/calm-turtle')

    // Capybara's first-ever scan in the suite -- found popup before Challenge 1.
    await expect(page.getByText('You found')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Capybara' })).toBeVisible()
    await page.getByRole('button', { name: 'Start Challenges' }).click()
    await expect(page.getByText('Capybara — Challenge 1')).toBeVisible()

    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Scavenger Hunt' }).click()
    const capybaraCard = page.locator('.hunt-character-card', { hasText: 'Capybara' })
    await expect(capybaraCard).not.toHaveClass(/hunt-character-locked/)
  })

  test('/scan/:code deep link for an unknown code also shows not-found, not a crash', async ({ page }) => {
    await page.goto('/scan/nonexistent-code')
    await expect(page.getByText(/couldn't find a code matching/i)).toBeVisible()
  })
})
