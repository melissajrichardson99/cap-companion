import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import {
  ANIMAL_SHOW_TIMES,
  PARK_HOURS_TEXT,
  TRACTOR_RIDE_TIMES_EAST,
  TRACTOR_RIDE_TIMES_WEST,
} from '../src/homePageContent'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

const HOME_HEADING = /Welcome to Cobb's Adventure Park/

// Schedule times render as individual chips (not a single joined string), so
// assertions locate a block by its heading and check its chips' texts as an
// array -- exact per-chip match, since (now that West's edge times are
// trimmed) West's hourly chips fully overlap Animal Shows' as substrings.
function scheduleChips(page: Page, headingSubstring: string) {
  return page
    .locator('.home-schedule-block')
    .filter({ has: page.locator('.home-schedule-heading', { hasText: headingSubstring }) })
    .locator('.home-schedule-time-chip')
}

// The Favorite Photo tab lives inside the guest nav's dropdown panel, which
// starts closed on every fresh page load -- same gotcha as favorite-photo.spec.ts.
async function openFavoritePhoto(page: Page) {
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
}

async function submitPhoto(page: Page, label: string) {
  await page.goto('/')
  await openFavoritePhoto(page)
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(label)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()
}

async function shortlistPhoto(staffPage: Page, label: string) {
  const row = staffPage.locator('.staff-photo-row', { hasText: label })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Approve' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: label })).toHaveCount(0)
}

async function voteForLabel(page: Page, label: string) {
  await page.goto('/')
  await openFavoritePhoto(page)
  const card = page.locator('.photo-card', { hasText: label })
  await card.getByRole('button', { name: /^Vote/ }).click()
  await expect(card.getByRole('button', { name: /^✓ Voted/ })).toBeDisabled()
}

// This spec relies on running against a freshly-reset DB (global-setup.ts
// wipes all photo_submissions before the suite runs) so the "no shortlisted
// photos yet" case below reflects real backend state, not a mocked response
// -- run this file on its own (`npx playwright test e2e/home-page.spec.ts`)
// rather than interleaved with specs that create their own photos first.

// Announcements are staff-managed and live now (not config) -- covered by
// announcements.spec.ts, not this file.
test('root route lands on Home with schedule and hours from config', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible()
  await expect(page.getByText(PARK_HOURS_TEXT)).toBeVisible()
  await expect(scheduleChips(page, 'Animal Shows')).toHaveText(ANIMAL_SHOW_TIMES)
  await expect(scheduleChips(page, 'Tractor Rides — West')).toHaveText(TRACTOR_RIDE_TIMES_WEST)
  await expect(scheduleChips(page, 'Tractor Rides — East')).toHaveText(TRACTOR_RIDE_TIMES_EAST)
})

test('no shortlisted photos yet renders an empty state, not a broken image', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('No favorite photo yet — submit and vote in Favorite Photo!')).toBeVisible()
  await expect(page.locator('.home-photo-image')).toHaveCount(0)
})

test('weather fetch failure degrades gracefully without blocking the rest of the page', async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByText('Weather unavailable right now')).toBeVisible()
  // The rest of the page still rendered despite the blocked weather call.
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible()
  await expect(page.getByText(PARK_HOURS_TEXT)).toBeVisible()
  await expect(scheduleChips(page, 'Animal Shows')).toHaveText(ANIMAL_SHOW_TIMES)
})

test('review card CTA opens the Google review link in a new tab without navigating away', async ({ page, context }) => {
  await page.goto('/')
  const reviewLink = page.getByRole('link', { name: /Leave a Google Review/ })
  await expect(reviewLink).toBeVisible()
  await expect(reviewLink).toHaveAttribute('target', '_blank')
  await expect(reviewLink).toHaveAttribute('rel', /noopener/)
  await expect(reviewLink).toHaveAttribute('href', /^https:\/\/www\.google\.com\/search\?/)

  const [newPage] = await Promise.all([context.waitForEvent('page'), reviewLink.click()])
  await newPage.waitForLoadState('domcontentloaded')
  expect(newPage.url()).toContain('google.com')
  await newPage.close()

  // Clicking the CTA didn't navigate the original tab away from Home.
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible()
})

test('navbar logo returns to Home from another screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible()

  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Bingo Card' }).click()
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toHaveCount(0)

  await page.getByRole('button', { name: 'Go to home page' }).click()
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible()
})

test('Photo of the Day renders the actual highest-voted shortlisted photo', async ({ page, context, browser }) => {
  const lowLabel = `E2E Home Low ${Date.now()}`
  const highLabel = `E2E Home High ${Date.now()}`

  await submitPhoto(page, lowLabel)
  await submitPhoto(page, highLabel)

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await shortlistPhoto(staffPage, lowLabel)
  await shortlistPhoto(staffPage, highLabel)

  // Voter A (the default context/page): one vote for each photo.
  await voteForLabel(page, highLabel)
  await voteForLabel(page, lowLabel)

  // Voter B: a second, independent device session (separate browser
  // context -> separate localStorage) casting a second vote for highLabel
  // only, so it ends up strictly ahead (2 votes vs. 1).
  const voterBContext = await browser.newContext()
  const voterBPage = await voterBContext.newPage()
  await voteForLabel(voterBPage, highLabel)
  await voterBContext.close()

  await page.goto('/')
  const caption = page.locator('.home-photo-caption')
  await expect(caption).toContainText(highLabel)
  await expect(caption).toContainText('2 votes')
  await expect(page.locator('.home-photo-frame')).not.toContainText(lowLabel)
})
