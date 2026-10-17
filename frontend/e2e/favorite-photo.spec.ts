import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { openNavMenu, openTab } from './navMenuHelper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')
const API = 'http://localhost:8000'

// Covers Favorite Photo (Plan.md 2.14, migration 012_favorite_photo.sql),
// now on the unified per-device session (Per-Device Sessions Phase 5,
// migration 028) instead of the retired voterSession.ts. Seeds an explicit
// device session token before first navigation (deviceSessionHelper.ts's
// seedDeviceSession), mirroring puzzle-timer.spec.ts/collectible-cards.spec.ts,
// so a test that also needs raw API calls in the same session can do so via
// withSession.

// The Favorite Photo tab lives inside the guest nav's dropdown panel, which
// starts closed on every fresh page load -- open it before selecting a tab.
async function openFavoritePhoto(page: Page, token: string = crypto.randomUUID()): Promise<string> {
  await seedDeviceSession(page, token)
  await page.goto('/')
  await openTab(page, 'Favorite Photo')
  return token
}

// Submits a photo under `token`'s session, then opens/logs into a fresh
// staff page and approves it into the shortlist. Staff must log in AFTER
// the guest submission, not before -- the Photo Queue is fetched once on
// login and never polls, so logging in first would see a stale, pre-
// submission empty queue and never find the row to approve.
async function submitAndShortlist(
  page: Page,
  context: BrowserContext,
  guestLabel: string,
  token?: string,
): Promise<{ token: string; staffPage: Page }> {
  const usedToken = await openFavoritePhoto(page, token)
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(guestLabel)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()

  const staffPage = await context.newPage()
  // Remove (used in cleanup below) gates on a native window.confirm() --
  // auto-accept it, same as staff-shortlisted-photos.spec.ts's individual
  // Remove test does.
  staffPage.on('dialog', (dialog) => dialog.accept())
  await loginAsStaff(staffPage)

  const staffRow = staffPage.locator('.staff-photo-row', { hasText: guestLabel })
  await expect(staffRow).toBeVisible()
  await staffRow.getByRole('button', { name: 'Approve' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: guestLabel })).toHaveCount(0)
  return { token: usedToken, staffPage }
}

async function removeFromShortlist(staffPage: Page, guestLabel: string): Promise<void> {
  await staffPage.locator('.staff-shortlisted-row', { hasText: guestLabel }).getByRole('button', { name: 'Remove' }).click()
  await expect(staffPage.locator('.staff-shortlisted-row', { hasText: guestLabel })).toHaveCount(0)
}

async function findSubmissionId(request: APIRequestContext, token: string, guestLabel: string): Promise<string> {
  const res = await request.get(`${API}/photos/gallery`, withSession(token))
  const gallery: { id: string; guest_label: string | null }[] = await res.json()
  return gallery.find((p) => p.guest_label === guestLabel)!.id
}

test('the submission form shows the email consent line with a working /privacy link', async ({ page }) => {
  await openFavoritePhoto(page)
  await expect(page.getByPlaceholder('Email (optional)')).toBeVisible()
  const consent = page.locator('.photo-email-consent')
  await expect(consent).toContainText("Your email is only visible to park staff and won't be shared")
  const privacyLink = consent.getByRole('link', { name: 'Privacy Policy' })
  await expect(privacyLink).toHaveAttribute('href', '/privacy')
  await privacyLink.click()
  await expect(page).toHaveURL(/\/privacy$/)
})

// Upload hardening (backend/app/uploads.py): the guest sees the backend's
// plain-language reason, not a raw status line.
test('a file that is not really a photo is turned away with a plain-language message', async ({ page }) => {
  await openFavoritePhoto(page)
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles({
    name: 'holiday.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('<!doctype html><script>alert(1)</script>'),
  })
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.locator('.photo-submit .screen-error')).toHaveText(
    "That file isn't a supported photo. Please choose a JPEG, PNG or WebP image.",
  )
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toHaveCount(0)
})

test('a photo over 15 MB is turned away before uploading, with a plain-language message', async ({ page }) => {
  await openFavoritePhoto(page)
  let uploadRequests = 0
  page.on('request', (req) => {
    if (req.url().endsWith('/photos/submit')) uploadRequests += 1
  })
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles({
    name: 'huge.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(15 * 1024 * 1024 + 1),
  })
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.locator('.photo-submit .screen-error')).toHaveText(
    'That photo is too large to upload. Please choose one under 15 MB.',
  )
  expect(uploadRequests).toBe(0)
})

test('a submitted email never appears on the guest-facing gallery, even after the photo is shortlisted', async ({
  page,
  context,
}) => {
  const guestLabel = `E2E Guest EmailPrivacy ${Date.now()}`
  const submittedEmail = `e2e-privacy-${Date.now()}@example.com`

  await openFavoritePhoto(page)
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(guestLabel)
  await page.getByPlaceholder('Email (optional)').fill(submittedEmail)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()

  const staffPage = await context.newPage()
  staffPage.on('dialog', (dialog) => dialog.accept())
  await loginAsStaff(staffPage)
  const staffRow = staffPage.locator('.staff-photo-row', { hasText: guestLabel })
  await expect(staffRow.locator('.staff-photo-email')).toHaveText(submittedEmail)
  await staffRow.getByRole('button', { name: 'Approve' }).click()

  await page.goto('/')
  await openFavoritePhoto(page)
  const galleryCard = page.locator('.photo-card', { hasText: guestLabel })
  await expect(galleryCard).toBeVisible()
  await expect(galleryCard).not.toContainText(submittedEmail)
  const galleryHtml = await page.content()
  expect(galleryHtml).not.toContain(submittedEmail)

  await removeFromShortlist(staffPage, guestLabel)
})

test('submit -> staff shortlist -> gallery -> vote -> duplicate vote rejected', async ({ page, context, request }) => {
  const guestLabel = `E2E Guest ${Date.now()}`

  const { token, staffPage } = await submitAndShortlist(page, context, guestLabel)

  await page.goto('/')
  await openFavoritePhoto(page, token)
  const galleryCard = page.locator('.photo-card', { hasText: guestLabel })
  await expect(galleryCard).toBeVisible()
  const voteButton = galleryCard.getByRole('button', { name: 'Vote (0)' })
  await expect(voteButton).toBeEnabled()
  await voteButton.click()
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (1)' })).toBeDisabled()

  // Confirm the vote persisted server-side (not just local component state)
  // by reloading fresh and checking voted_by_me still comes back true.
  await page.goto('/')
  await openFavoritePhoto(page, token)
  await expect(
    page.locator('.photo-card', { hasText: guestLabel }).getByRole('button', { name: '✓ Voted (1)' }),
  ).toBeDisabled()

  const submissionId = await findSubmissionId(request, token, guestLabel)
  const duplicateVoteRes = await request.post(`${API}/photos/${submissionId}/vote`, withSession(token))
  expect(duplicateVoteRes.status()).toBe(409)

  // Clean up the shortlisted photo this test created -- this DB persists
  // across spec files (only reset once, up front, by global-setup.ts), so
  // leaving it shortlisted would make home-page.spec.ts's "no shortlisted
  // photos yet" test see a stale photo depending on run order.
  await removeFromShortlist(staffPage, guestLabel)
})

test('two device sessions each cast their own vote independently, and the aggregate tally reflects both', async ({
  page,
  context,
  request,
}) => {
  const guestLabel = `E2E Guest TwoSessions ${Date.now()}`

  const { token: tokenA, staffPage } = await submitAndShortlist(page, context, guestLabel)
  const tokenB = crypto.randomUUID()

  const submissionId = await findSubmissionId(request, tokenA, guestLabel)

  const voteA = await request.post(`${API}/photos/${submissionId}/vote`, withSession(tokenA))
  expect(voteA.ok()).toBe(true)

  // Session B has never voted -- the count is global (already reflects A's
  // vote), but B's own voted_by_me must still be false, since dedup is
  // scoped per session, not shared.
  const galleryForB = await request.get(`${API}/photos/gallery`, withSession(tokenB))
  const bView = (await galleryForB.json()).find((p: { id: string }) => p.id === submissionId)
  expect(bView.voted_by_me).toBe(false)
  expect(bView.vote_count).toBe(1)

  const voteB = await request.post(`${API}/photos/${submissionId}/vote`, withSession(tokenB))
  expect(voteB.ok()).toBe(true)

  // Neither session blocked the other, and the aggregate tally sums both --
  // scoped to session_id for dedup, not scoped for the count itself.
  const galleryForA = await request.get(`${API}/photos/gallery`, withSession(tokenA))
  const aView = (await galleryForA.json()).find((p: { id: string }) => p.id === submissionId)
  expect(aView.vote_count).toBe(2)
  expect(aView.voted_by_me).toBe(true)

  const galleryForBAfter = await request.get(`${API}/photos/gallery`, withSession(tokenB))
  const bViewAfter = (await galleryForBAfter.json()).find((p: { id: string }) => p.id === submissionId)
  expect(bViewAfter.vote_count).toBe(2)
  expect(bViewAfter.voted_by_me).toBe(true)

  await removeFromShortlist(staffPage, guestLabel)
})

// Per-Device Sessions Phase 5: the old voterSession.ts let a guest vote
// again after Reset Session by minting a brand-new local token, silently
// leaving the prior vote (and its count) in the tally forever -- the same
// physical device's tally went 1 -> 2 across a reset-then-revote cycle. The
// unified device session token deliberately does NOT rotate on Reset
// Session (Phase 4's confirmed finding), so "vote again" now works because
// POST /session/reset itself deletes this session's own photo_votes row --
// the tally correctly nets back to 1, not 2.
test('Reset Session deletes this session\'s own vote so it can vote again, under the SAME session token, without double-counting the tally', async ({
  page,
  context,
}) => {
  const guestLabel = `E2E Guest ResetVote ${Date.now()}`

  const { token, staffPage } = await submitAndShortlist(page, context, guestLabel)

  await page.goto('/')
  await openFavoritePhoto(page, token)
  const galleryCard = page.locator('.photo-card', { hasText: guestLabel })
  await expect(galleryCard).toBeVisible()
  await galleryCard.getByRole('button', { name: 'Vote (0)' }).click()
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (1)' })).toBeDisabled()

  const tokenBeforeReset = await page.evaluate(() => localStorage.getItem('cap-device-session-id'))
  expect(tokenBeforeReset).toBe(token)

  await openNavMenu(page)
  await page.getByRole('button', { name: 'Reset Session' }).click()
  const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
  await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
  await expect(resetConfirmDialog).toHaveCount(0)

  // The vote itself was deleted server-side (not left stale like the old
  // mechanism) -- the tally drops back to 0, not still 1.
  const voteButtonAfterReset = galleryCard.getByRole('button', { name: 'Vote (0)' })
  await expect(voteButtonAfterReset).toBeEnabled()

  // The device session token is unchanged by Reset Session -- unlike
  // voterSession.ts's old fresh-id-per-reset behavior, this is the SAME
  // token as before, confirming the revote below happens under one
  // continuous session_id rather than a new one.
  const tokenAfterReset = await page.evaluate(() => localStorage.getItem('cap-device-session-id'))
  expect(tokenAfterReset).toBe(token)

  await voteButtonAfterReset.click()
  // Nets back to 1, not 2 -- confirms the old double-count gap is closed.
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (1)' })).toBeDisabled()

  await removeFromShortlist(staffPage, guestLabel)
})
