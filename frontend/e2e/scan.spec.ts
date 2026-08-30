import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
// Also covers ScanEntryModal's unified handling of the other 3 QR-routable
// destinations (Animals, Scoring, Puzzles) -- previously camera decode
// treated any decoded URL that didn't match /scan/xxx as a bare Hunt code
// (always 404ing), and manual entry only ever navigated to /scan/:code
// regardless of what was typed. See the "unified scan resolution" describe
// block below; the collision test there shells out to a backend fixture
// script (same execFileSync-a-Python-script pattern as global-setup.ts)
// since there's no staff-facing creation UI to seed a genuine cross-type
// collision through the app itself.
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
  // Scoped to the nav panel -- Home's Choose Your Adventure section
  // (HomePage.tsx) has its own "Scan QR" quicknav button with the same
  // accessible name, so an unscoped getByRole here is ambiguous whenever
  // Home is the landing screen.
  await page.locator('#nav-menu-panel').getByRole('button', { name: 'Scan QR' }).click()
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
    await modal.getByLabel("What's on the sign").fill('brave-otter')
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
    await modal.getByLabel("What's on the sign").fill('  Brave Otter  ')
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
    await modal.getByLabel("What's on the sign").fill('jolly-zebra')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByRole('heading', { name: 'Red Panda' })).toBeVisible()
    await expect(page.getByText('Coming soon!')).toBeVisible()
  })

  test('an unknown code shows a clear not-found state, not a broken page', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel("What's on the sign").fill('totally-bogus-code')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByText(/couldn't find a code matching/i)).toBeVisible()
    await page.getByRole('button', { name: 'Back to the app' }).click()
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.locator('#nav-menu-panel').getByRole('button', { name: 'Scan QR' })).toBeVisible()
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
    await expect(page.locator('#nav-menu-panel').getByRole('button', { name: 'Scan QR' })).toBeVisible()
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..', '..', 'backend')
const backendPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe')

test.describe('unified scan resolution (Animals / Scoring / Puzzles)', () => {
  test.beforeEach(async ({ page }) => {
    await seedDeviceSession(page, crypto.randomUUID())
  })

  test('camera scan (mocked decode) of an Animals QR routes straight to that animal, not a bare-code 404', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      class FakeBarcodeDetector {
        async detect() {
          return [{ rawValue: 'https://cap-companion.example/animals/goat' }]
        }
      }
      // @ts-expect-error test-only global stub
      window.BarcodeDetector = FakeBarcodeDetector
      // @ts-expect-error test-only global stub
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 10
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'green'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(10)
      }
    })

    await openScanEntry(page)

    await expect(page).toHaveURL(/\/animals\/goat$/)
    await expect(page.getByRole('heading', { name: 'Goat', exact: true })).toBeVisible()
  })

  test('camera scan (mocked decode) of a Scoring QR routes straight to that game', async ({ page }) => {
    await page.addInitScript(() => {
      class FakeBarcodeDetector {
        async detect() {
          return [{ rawValue: 'https://cap-companion.example/scoring/farm-toss' }]
        }
      }
      // @ts-expect-error test-only global stub
      window.BarcodeDetector = FakeBarcodeDetector
      // @ts-expect-error test-only global stub
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 10
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'green'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(10)
      }
    })

    await openScanEntry(page)

    await expect(page).toHaveURL(/\/scoring\/farm-toss$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Farm Toss', { exact: true })).toBeVisible()
  })

  test('camera scan (mocked decode) of a Puzzles QR routes straight to that challenge', async ({ page }) => {
    await page.addInitScript(() => {
      class FakeBarcodeDetector {
        async detect() {
          return [{ rawValue: 'https://cap-companion.example/puzzles/math-maze-standard' }]
        }
      }
      // @ts-expect-error test-only global stub
      window.BarcodeDetector = FakeBarcodeDetector
      // @ts-expect-error test-only global stub
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 10
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'green'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(10)
      }
    })

    await openScanEntry(page)

    await expect(page).toHaveURL(/\/puzzles\/math-maze-standard$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Math Maze — Standard')).toBeVisible()
  })

  test('camera scan (mocked decode) of a bare code with no URL still resolves, same as manual entry', async ({
    page,
  }) => {
    // A sign that somehow encodes just the bare code, not a full URL --
    // this has no recognizable /scan//animals//scoring//puzzles/ prefix to
    // route on directly, so it must fall through to the same server-side
    // lookup manual entry uses, rather than 404ing as a bad /scan/:code.
    await page.addInitScript(() => {
      class FakeBarcodeDetector {
        async detect() {
          return [{ rawValue: 'quick-falcon' }]
        }
      }
      // @ts-expect-error test-only global stub
      window.BarcodeDetector = FakeBarcodeDetector
      // @ts-expect-error test-only global stub
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 10
        canvas.height = 10
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'green'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.captureStream(10)
      }
    })

    await openScanEntry(page)

    // Snake's first-ever scan in the suite -- found popup before Challenge 1.
    await expect(page.getByText('You found')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Snake' })).toBeVisible()
    await page.getByRole('button', { name: 'Start Challenges' }).click()
    await expect(page.getByText('Snake — Challenge 1')).toBeVisible()
    await expect(page).toHaveURL(/\/scan\/quick-falcon$/)
  })

  test('manual entry resolves an Animal slug and routes to that animal', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel("What's on the sign").fill('goat')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page).toHaveURL(/\/animals\/goat$/)
    await expect(page.getByRole('heading', { name: 'Goat', exact: true })).toBeVisible()
  })

  test('manual entry resolves a Scoring game slug and routes to that game', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel("What's on the sign").fill('farm-toss')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page).toHaveURL(/\/scoring\/farm-toss$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Farm Toss', { exact: true })).toBeVisible()
  })

  test('manual entry resolves a Puzzle challenge slug and routes to that challenge', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel("What's on the sign").fill('math-maze-standard')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page).toHaveURL(/\/puzzles\/math-maze-standard$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Math Maze — Standard')).toBeVisible()
  })

  test('manual entry is case-insensitive/whitespace-tolerant for non-Hunt slugs too', async ({ page }) => {
    await openScanEntry(page)

    const modal = page.locator('.modal-panel')
    await modal.getByLabel("What's on the sign").fill('  Farm Toss  ')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page).toHaveURL(/\/scoring\/farm-toss$/)
  })

  test('a manual entry matching more than one destination shows a clear error, not a silent wrong redirect', async ({
    page,
  }) => {
    // No real collision exists in seed data -- temporarily makes the
    // existing "farm-toss" Scoring Sheet slug also exist as a
    // scannable_codes code, via a test-only backend fixture script (see
    // backend/scripts/e2e_collision_fixture.py), so resolve_manual_entry()
    // has a genuine two-source collision to 409 on. Always cleaned up, even
    // if an assertion below throws.
    execFileSync(backendPython, ['scripts/e2e_collision_fixture.py', 'insert'], { cwd: backendDir, stdio: 'inherit' })
    try {
      await openScanEntry(page)

      const modal = page.locator('.modal-panel')
      await modal.getByLabel("What's on the sign").fill('farm-toss')
      await modal.getByRole('button', { name: 'Go' }).click()

      await expect(page.getByText(/matches more than one/i)).toBeVisible()
      // No silent wrong-destination redirect -- still on the scan-entry
      // modal, not routed to either colliding destination.
      await expect(modal).toBeVisible()
      await expect(page).not.toHaveURL(/\/scoring\/farm-toss$/)
      await expect(page).not.toHaveURL(/\/scan\/farm-toss$/)
    } finally {
      execFileSync(backendPython, ['scripts/e2e_collision_fixture.py', 'remove'], { cwd: backendDir, stdio: 'inherit' })
    }
  })
})
