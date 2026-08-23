import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// The Favorite Photo tab lives inside the guest nav's dropdown panel, which
// starts closed on every fresh page load -- open it before selecting a tab.
async function openFavoritePhoto(page: Page) {
  await page.getByRole('button', { name: 'Open menu' }).click()
  // The tab list uses role="menuitemradio" (NavMenu.tsx), not the button
  // tag's implicit "button" role.
  await page.getByRole('menuitemradio', { name: 'Favorite Photo' }).click()
}

// Covers Favorite Photo (Plan.md 2.14, migration 012_favorite_photo.sql):
// guest submission -> staff shortlist -> public gallery -> vote -> a second
// vote attempt from the same voter_session_id is rejected. The vote button
// disables itself client-side after voting, so a duplicate vote is only
// really exercised by hitting the API directly (bypassing the disabled
// button), which is what the last step below does.
test('submit -> staff shortlist -> gallery -> vote -> duplicate vote rejected', async ({ page, context }) => {
  const guestLabel = `E2E Guest ${Date.now()}`

  await page.goto('/')
  await openFavoritePhoto(page)
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

  await page.goto('/')
  await openFavoritePhoto(page)
  const galleryCard = page.locator('.photo-card', { hasText: guestLabel })
  await expect(galleryCard).toBeVisible()
  const voteButton = galleryCard.getByRole('button', { name: 'Vote (0)' })
  await expect(voteButton).toBeEnabled()
  await voteButton.click()
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (1)' })).toBeDisabled()

  // Confirm the vote persisted server-side (not just local component state)
  // by reloading fresh and checking voted_by_me still comes back true.
  await page.goto('/')
  await openFavoritePhoto(page)
  await expect(
    page.locator('.photo-card', { hasText: guestLabel }).getByRole('button', { name: '✓ Voted (1)' }),
  ).toBeDisabled()

  const duplicateVoteStatus = await page.evaluate(async (label) => {
    const voterSessionId = localStorage.getItem('cap-voter-session-id')
    const galleryRes = await fetch(`http://localhost:8000/photos/gallery?voter_session_id=${voterSessionId}`)
    const gallery: { id: string; guest_label: string | null }[] = await galleryRes.json()
    const submission = gallery.find((p) => p.guest_label === label)
    const voteRes = await fetch(`http://localhost:8000/photos/${submission!.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voter_session_id: voterSessionId }),
    })
    return voteRes.status
  }, guestLabel)
  expect(duplicateVoteStatus).toBe(409)

  // Clean up the shortlisted photo this test created -- this DB persists
  // across spec files (only reset once, up front, by global-setup.ts), so
  // leaving it shortlisted would make home-page.spec.ts's "no shortlisted
  // photos yet" test see a stale photo depending on run order.
  await staffPage.locator('.staff-shortlisted-row', { hasText: guestLabel }).getByRole('button', { name: 'Remove' }).click()
  await expect(staffPage.locator('.staff-shortlisted-row', { hasText: guestLabel })).toHaveCount(0)
})

// Reset Session (voterSession.ts) previously left this device's vote-dedup
// marker untouched by original design -- that's the gap this covers: the
// marker must now be cleared so a fresh session can vote again, while the
// vote already cast (and its tally) stays exactly as-is server-side, same
// as Reset Session leaving Hunt/Coin history from other visits alone.
test('Reset Session clears the local vote-dedup marker so the guest can vote again, without touching the already-cast vote or its tally', async ({
  page,
  context,
}) => {
  const guestLabel = `E2E Guest ResetVote ${Date.now()}`

  await page.goto('/')
  await openFavoritePhoto(page)
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(guestLabel)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()

  const staffPage = await context.newPage()
  staffPage.on('dialog', (dialog) => dialog.accept())
  await loginAsStaff(staffPage)
  const staffRow = staffPage.locator('.staff-photo-row', { hasText: guestLabel })
  await expect(staffRow).toBeVisible()
  await staffRow.getByRole('button', { name: 'Approve' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: guestLabel })).toHaveCount(0)

  await page.goto('/')
  await openFavoritePhoto(page)
  const galleryCard = page.locator('.photo-card', { hasText: guestLabel })
  await expect(galleryCard).toBeVisible()
  await galleryCard.getByRole('button', { name: 'Vote (0)' }).click()
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (1)' })).toBeDisabled()

  const originalVoterSessionId = await page.evaluate(() => localStorage.getItem('cap-voter-session-id'))

  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Reset Session' }).click()
  const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
  await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
  await expect(resetConfirmDialog).toHaveCount(0)

  // The prior vote's tally is untouched (still 1) -- only this device's own
  // "have I voted" marker was cleared, so the button re-enables.
  const voteButtonAfterReset = galleryCard.getByRole('button', { name: 'Vote (1)' })
  await expect(voteButtonAfterReset).toBeEnabled()

  // Reset Session's own reload of the gallery (App.tsx's handleResetSession)
  // already mints a fresh id via getVoterSessionId() to fetch voted_by_me
  // with, so the old id is gone by now, not merely absent-until-next-vote.
  const voterSessionIdAfterReset = await page.evaluate(() => localStorage.getItem('cap-voter-session-id'))
  expect(voterSessionIdAfterReset).not.toBe(originalVoterSessionId)

  await voteButtonAfterReset.click()
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (2)' })).toBeDisabled()

  await staffPage.locator('.staff-shortlisted-row', { hasText: guestLabel }).getByRole('button', { name: 'Remove' }).click()
  await expect(staffPage.locator('.staff-shortlisted-row', { hasText: guestLabel })).toHaveCount(0)
})
