import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import { ANIMAL_SHOW_TIMES, TRACTOR_RIDE_TIMES_EAST, TRACTOR_RIDE_TIMES_WEST } from '../src/homePageContent'

// Fri Sep 4 2026 -- an ordinary open day under the real seasonal schedule
// (Sept/Oct is Fri-Sun) and not a holiday, used by the status-text tests
// below to pin the before/during/after states without racing whatever the
// real wall-clock time happens to be when the suite runs. See
// park-schedule.spec.ts for the schedule/holiday math itself; this file
// only covers what the Home page renders on top of it.
const OPEN_WEEKDAY_DATE = [2026, 8, 4] as const // months are 0-indexed (8 = September)

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
//
// Time isn't mocked here (this is a general smoke test, not schedule
// coverage -- that's the 'park status' describe block below), so the
// open/closed status text is asserted loosely: it must be one of the two
// known shapes, not a specific value, since the suite can run on any date.
test('root route lands on Home with schedule from config and a real computed status line', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible()
  await expect(page.locator('.home-status-text')).toHaveText(/^(Closes in|Opens)/)
  // The old fixed "Wednesday – Sunday, 11:00 AM – 5:00 PM" text is gone --
  // hours are only ever shown via the computed status line above.
  await expect(page.getByText(/Wednesday.*Sunday/)).toHaveCount(0)
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
  await expect(page.locator('.home-status-text')).toHaveText(/^(Closes in|Opens)/)
  await expect(scheduleChips(page, 'Animal Shows')).toHaveText(ANIMAL_SHOW_TIMES)
})

// Schedule/holiday date math itself (which days are open, holiday
// computation across years, off-season next-open search) is unit-tested in
// park-schedule.spec.ts. This describe block only covers what the Home page
// renders on top of that: the badge, the status line's position (where the
// old hardcoded hours text used to sit), and both countdown directions.
test.describe('park status (open/closed) display', () => {
  test('before opening on an open day shows the opening time and an Open Today badge, not a countdown', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(...OPEN_WEEKDAY_DATE, 9, 30))
    await page.goto('/')
    await expect(page.getByText('Open Today')).toBeVisible()
    // Regex (not an exact string) -- ICU may render the AM/PM separator as a
    // narrow no-break space rather than a plain one, and \s matches either.
    await expect(page.getByText(/Opens at 11:00\s*AM/)).toBeVisible()
    await expect(page.getByText(/Closes in/)).toHaveCount(0)
  })

  test('currently open shows a live countdown to close', async ({ page }) => {
    await page.clock.setFixedTime(new Date(...OPEN_WEEKDAY_DATE, 14, 45))
    await page.goto('/')
    await expect(page.getByText('Open Today')).toBeVisible()
    await expect(page.getByText('Closes in 2h 15m')).toBeVisible()
  })

  test('after closing on an open day still shows Open Today, plus when the park opens next (not a negative countdown)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(...OPEN_WEEKDAY_DATE, 18, 0))
    await page.goto('/')
    // Today (a Friday) stays "Open Today" all day even after closing --
    // that badge reflects the day's schedule, not the current instant.
    await expect(page.getByText('Open Today')).toBeVisible()
    await expect(page.getByText(/Closes in/)).toHaveCount(0)
    // The next open day (Saturday) is tomorrow under the real Sept schedule.
    await expect(page.getByText(/Opens tomorrow at 11:00\s*AM/)).toBeVisible()
  })

  test('on a day the park is closed, the badge and status text read naturally together, not redundantly', async ({
    page,
  }) => {
    // Monday May 11 2026 -- May is Sat/Sun only and this isn't Victoria Day,
    // so the park is fully closed; next open day is Saturday, 5 days out.
    await page.clock.setFixedTime(new Date(2026, 4, 11, 10, 0))
    await page.goto('/')
    await expect(page.getByText('Closed Today')).toBeVisible()
    await expect(page.getByText(/Opens Saturday at 11:00\s*AM/)).toBeVisible()
    await expect(page.getByText(/Closes in/)).toHaveCount(0)
  })

  test('deep in the off-season, shows a far-future opening date rather than a ticking countdown', async ({
    page,
  }) => {
    // Nov 2 2026 -- the season's last open weekend was Oct 30-31, so this is
    // safely into the unconditional Nov-Apr closure; next open day is the
    // following May, months away.
    await page.clock.setFixedTime(new Date(2026, 10, 2, 12, 0))
    await page.goto('/')
    await expect(page.getByText('Closed Today')).toBeVisible()
    await expect(page.getByText('Opens May 1, 2027')).toBeVisible()
  })
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

// DOCUMENT_POSITION_FOLLOWING (4) means the reference node comes after the
// node compareDocumentPosition was called on -- i.e. `a` precedes `b` in
// page order.
async function isBefore(a: Locator, b: Locator): Promise<boolean> {
  return a.evaluate(
    (el, target) => !!(el.compareDocumentPosition(target as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await b.elementHandle(),
  )
}

test('How It Works card renders between Announcements/Reviews and the end of the page', async ({ page }) => {
  await page.goto('/')
  const howto = page.getByRole('heading', { name: 'How It Works' })
  await expect(howto).toBeVisible()
  await expect(page.locator('.home-howto-list .home-howto-step')).toHaveCount(5)

  const reviewCard = page.getByRole('heading', { name: 'Leave a Review, Get a Treat!' }).locator('..')
  const howtoCard = howto.locator('..')

  expect(await isBefore(reviewCard, howtoCard)).toBe(true)
})

test('Choose Your Adventure renders first on the page, above the weather/hours card, How It Works, and Announcements/Reviews', async ({
  page,
}) => {
  await page.goto('/')
  const adventureCard = page.getByRole('heading', { name: 'Choose Your Adventure' }).locator('..')
  const todayCard = page.getByRole('heading', { name: "Today at Cobb's" }).locator('..')
  const howtoCard = page.getByRole('heading', { name: 'How It Works' }).locator('..')
  const reviewCard = page.getByRole('heading', { name: 'Leave a Review, Get a Treat!' }).locator('..')

  expect(await isBefore(adventureCard, todayCard)).toBe(true)
  expect(await isBefore(adventureCard, howtoCard)).toBe(true)
  expect(await isBefore(adventureCard, reviewCard)).toBe(true)
})

test('Choose Your Adventure quick-nav card links to the right destinations', async ({ page }) => {
  await page.goto('/')
  const quicknav = page.locator('.home-quicknav-grid')
  await expect(quicknav.getByRole('button', { name: 'Map' })).toBeVisible()
  await expect(quicknav.getByRole('button', { name: 'Bingo Card' })).toBeVisible()
  await expect(quicknav.getByRole('button', { name: 'Scan QR' })).toBeVisible()
  await expect(quicknav.getByRole('button', { name: 'Scoring Sheet' })).toBeVisible()
  await expect(quicknav.getByRole('button', { name: 'Collectibles' })).toBeVisible()
  await expect(page.getByText('Looking for something else? Check the menu in the top-right corner.')).toBeVisible()

  await quicknav.getByRole('button', { name: 'Map' }).click()
  await expect(page.getByRole('heading', { name: 'Park Map' })).toBeVisible()

  await page.getByRole('button', { name: 'Go to home page' }).click()
  await quicknav.getByRole('button', { name: 'Bingo Card' }).click()
  await expect(page.getByRole('heading', { name: 'Bingo Card' })).toBeVisible()

  await page.getByRole('button', { name: 'Go to home page' }).click()
  await quicknav.getByRole('button', { name: 'Scoring Sheet' }).click()
  await expect(page.getByRole('heading', { name: 'Scoring Sheet' })).toBeVisible()

  await page.getByRole('button', { name: 'Go to home page' }).click()
  await quicknav.getByRole('button', { name: 'Collectibles' }).click()
  await expect(page.getByRole('heading', { name: 'Collectibles' })).toBeVisible()

  await page.getByRole('button', { name: 'Go to home page' }).click()
  await quicknav.getByRole('button', { name: 'Scan QR' }).click()
  await expect(page.getByText('Scan a Code')).toBeVisible()
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
