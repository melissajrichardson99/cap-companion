import { test, expect } from '@playwright/test'
import { ANIMALS } from '../src/animalContent'
import { loginAsStaff } from './staffAuthHelper'

// Covers the Staff Page's "QR Codes" tab (StaffQrDirectory.tsx): a read-only
// reference listing every QR-ready destination in the app -- Our Animals,
// Scavenger Hunt characters, Scoring Sheet games, Puzzle challenges -- each
// with its full absolute URL and a copy-to-clipboard action, so staff can
// generate physical signage. Added alongside the /scoring/:gameSlug and
// /puzzles/:challengeSlug deep links (migration 032 + the new staff-only
// GET /hunt/scan-codes endpoint).
//
// Clipboard read/write needs an explicit grant here -- no prior e2e spec in
// this project exercises the clipboard.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

async function openQrCodesTab(page: import('@playwright/test').Page): Promise<void> {
  await loginAsStaff(page)
  await page.getByRole('tab', { name: 'QR Codes' }).click()
}

function section(page: import('@playwright/test').Page, title: string) {
  return page.locator('.staff-qr-section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

test.describe('Staff Page QR Code Directory', () => {
  test('lists all four sections with the correct entry counts', async ({ page }) => {
    await openQrCodesTab(page)

    const animalsSection = section(page, 'Our Animals')
    await expect(animalsSection.locator('.staff-qr-row')).toHaveCount(ANIMALS.length)

    const huntSection = section(page, 'Scavenger Hunt Characters')
    // 5 characters, each with a seeded scannable code (migration 009).
    await expect(huntSection.locator('.staff-qr-row')).toHaveCount(5)

    const scoringSection = section(page, 'Scoring Sheet Games')
    // Farm Toss, Horse Hoops, Cornhole, Cornhole Extreme, Tiki Toss / Ring & Hook,
    // plus the two stroke-play mini golf courses (migration 043).
    await expect(scoringSection.locator('.staff-qr-row')).toHaveCount(7)
    for (const [name, slug] of [
      ['Blacklight Mini Golf', 'blacklight-mini-golf'],
      ['Cornhole Mini Golf', 'cornhole-mini-golf'],
    ]) {
      await expect(scoringSection.locator('.staff-qr-row', { hasText: name }).locator('.staff-qr-row-url')).toHaveText(
        `http://localhost:5173/scoring/${slug}`,
      )
    }

    const puzzlesSection = section(page, 'Puzzle Challenges')
    // Pyramid Puzzler (3) + Math Maze (1) + Hop Dots (2) + Right Turn Only (1)
    // + Red White and Blue (1) + Big Mystery Maze (1) = 9.
    await expect(puzzlesSection.locator('.staff-qr-row')).toHaveCount(9)
  })

  test('shows correct absolute URLs for one entry of each type', async ({ page }) => {
    await openQrCodesTab(page)

    const animalRow = section(page, 'Our Animals').locator('.staff-qr-row', { hasText: 'Capybara' })
    await expect(animalRow.locator('.staff-qr-row-url')).toHaveText('http://localhost:5173/animals/capybara')

    const huntRow = section(page, 'Scavenger Hunt Characters').locator('.staff-qr-row', { hasText: 'Kangaroo' })
    await expect(huntRow.locator('.staff-qr-row-url')).toHaveText('http://localhost:5173/scan/brave-otter')

    const scoringRow = section(page, 'Scoring Sheet Games').locator('.staff-qr-row', { hasText: 'Farm Toss' })
    await expect(scoringRow.locator('.staff-qr-row-url')).toHaveText('http://localhost:5173/scoring/farm-toss')

    const puzzleRow = section(page, 'Puzzle Challenges').locator('.staff-qr-row', {
      hasText: 'Math Maze — Standard',
    })
    await expect(puzzleRow.locator('.staff-qr-row-url')).toHaveText(
      'http://localhost:5173/puzzles/math-maze-standard',
    )
  })

  test('copying a link actually populates the clipboard, and each visited URL lands on the right screen', async ({
    page,
  }) => {
    await openQrCodesTab(page)

    const scoringRow = section(page, 'Scoring Sheet Games').locator('.staff-qr-row', { hasText: 'Farm Toss' })
    await scoringRow.getByRole('button', { name: 'Copy Link' }).click()
    await expect(scoringRow.getByRole('button', { name: 'Copied!' })).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('http://localhost:5173/scoring/farm-toss')

    // End-to-end: the copied URL actually opens the right thing when visited.
    await page.goto(copied)
    await expect(page.getByRole('dialog').getByText('Farm Toss', { exact: true })).toBeVisible()
  })

  // Each row also shows the plain manual code (ScanEntryModal's "What's on
  // the sign" field takes free text, not a URL) and a matching Copy Code
  // button, distinct from Copy Link -- staff print this alongside the QR so
  // guests without a working camera can still type it in.
  test('shows the manual-entry code for one entry of each type, and Copy Code copies just the code', async ({
    page,
  }) => {
    await openQrCodesTab(page)

    const animalRow = section(page, 'Our Animals').locator('.staff-qr-row', { hasText: 'Capybara' })
    await expect(animalRow.locator('.staff-qr-row-code')).toHaveText('Manual code: capybara')

    const huntRow = section(page, 'Scavenger Hunt Characters').locator('.staff-qr-row', { hasText: 'Kangaroo' })
    await expect(huntRow.locator('.staff-qr-row-code')).toHaveText('Manual code: brave-otter')

    const scoringRow = section(page, 'Scoring Sheet Games').locator('.staff-qr-row', { hasText: 'Farm Toss' })
    await expect(scoringRow.locator('.staff-qr-row-code')).toHaveText('Manual code: farm-toss')

    const puzzleRow = section(page, 'Puzzle Challenges').locator('.staff-qr-row', {
      hasText: 'Math Maze — Standard',
    })
    await expect(puzzleRow.locator('.staff-qr-row-code')).toHaveText('Manual code: math-maze-standard')

    await scoringRow.getByRole('button', { name: 'Copy Code' }).click()
    await expect(scoringRow.getByRole('button', { name: 'Copied!' })).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('farm-toss')

    // Copy Link on the same row is unaffected -- the two buttons track their
    // own copied state independently.
    await expect(scoringRow.getByRole('button', { name: 'Copy Link' })).toBeVisible()
  })
})
