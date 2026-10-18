import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page, type Route } from '@playwright/test'
import { openNavMenu, openTab } from './navMenuHelper'

// What a guest sees when a per-device write limit (backend/app/rate_limit.py)
// answers 429: the backend's own sentence, shown where that screen already
// shows errors -- never a raw "POST /x -> 429: {...}" -- and the screen keeps
// working. The 429s are faked with page.route so this doesn't depend on
// actually exhausting a limit (the backend tests cover the limits themselves).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

const LIMIT_MESSAGE = 'Please wait 42 minutes and try again. (test limit message)'

function tooMany(route: Route) {
  return route.fulfill({
    status: 429,
    headers: { 'Retry-After': '2520', 'Access-Control-Allow-Origin': '*' },
    contentType: 'application/json',
    body: JSON.stringify({ detail: LIMIT_MESSAGE }),
  })
}

async function expectMessageNotRawError(page: Page) {
  await expect(page.locator('.screen-error', { hasText: LIMIT_MESSAGE })).toBeVisible()
  await expect(page.getByText('-> 429')).toHaveCount(0)
  await expect(page.getByText('"detail"')).toHaveCount(0)
}

test('Contact Staff: a 429 shows its message in the dialog, which stays usable', async ({ page }) => {
  await page.route('**/staff-requests', (route) => (route.request().method() === 'POST' ? tooMany(route) : route.fallback()))
  await page.goto('/')
  await openNavMenu(page)
  await page.getByRole('button', { name: 'Contact Staff' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'I have a question' }).click()
  await dialog.getByRole('button', { name: 'Restrooms', exact: true }).click()
  await dialog.getByRole('button', { name: 'Submit Question' }).click()

  await expectMessageNotRawError(page)
  await expect(dialog.getByText('Question sent')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Submit Question' })).toBeEnabled()
})

test('Favorite Photo: a 429 on upload shows its message, and the form stays usable', async ({ page }) => {
  await page.route('**/photos/submit', tooMany)
  await page.goto('/')
  await openTab(page, 'Favorite Photo')
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByRole('button', { name: 'Submit Photo' }).click()

  await expectMessageNotRawError(page)
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Submit Photo' })).toBeVisible()
})

test('Favorite Photo: a 429 on a vote shows its message, and the gallery stays usable', async ({ page }) => {
  const photo = {
    id: '00000000-0000-4000-8000-000000000429',
    guest_label: 'Rate Limit Family',
    email: null,
    photo_url: '/park-map.png',
    submitted_at: '2026-10-18T12:00:00Z',
    status: 'shortlisted',
    vote_count: 3,
    voted_by_me: false,
  }
  await page.route('**/photos/gallery', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([photo]) }),
  )
  await page.route(`**/photos/${photo.id}/vote`, tooMany)
  await page.goto('/')
  await openTab(page, 'Favorite Photo')
  const card = page.locator('.photo-card', { hasText: 'Rate Limit Family' })
  await card.getByRole('button', { name: 'Vote (3)' }).click()

  await expectMessageNotRawError(page)
  await expect(card.getByRole('button', { name: 'Vote (3)' })).toBeEnabled()
})
