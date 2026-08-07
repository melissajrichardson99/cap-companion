import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg')

// Covers Favorite Photo (Plan.md 2.14, migration 012_favorite_photo.sql):
// guest submission -> staff shortlist -> public gallery -> vote -> a second
// vote attempt from the same voter_session_id is rejected. The vote button
// disables itself client-side after voting, so a duplicate vote is only
// really exercised by hitting the API directly (bypassing the disabled
// button), which is what the last step below does.
test('submit -> staff shortlist -> gallery -> vote -> duplicate vote rejected', async ({ page, context }) => {
  const guestLabel = `E2E Guest ${Date.now()}`

  await page.goto('/')
  await page.getByRole('button', { name: 'Favorite Photo' }).click()
  await page.locator('.photo-submit-form input[type="file"]').setInputFiles(FIXTURE_PHOTO)
  await page.getByPlaceholder('Your name (optional)').fill(guestLabel)
  await page.getByRole('button', { name: 'Submit Photo' }).click()
  await expect(page.getByText('Thanks! Your photo is in for staff review.')).toBeVisible()

  const staffPage = await context.newPage()
  await staffPage.goto('/staff')
  const staffRow = staffPage.locator('.staff-photo-row', { hasText: guestLabel })
  await expect(staffRow).toBeVisible()
  await staffRow.getByRole('button', { name: 'Shortlist' }).click()
  await expect(staffPage.locator('.staff-photo-row', { hasText: guestLabel })).toHaveCount(0)

  await page.goto('/')
  await page.getByRole('button', { name: 'Favorite Photo' }).click()
  const galleryCard = page.locator('.photo-card', { hasText: guestLabel })
  await expect(galleryCard).toBeVisible()
  const voteButton = galleryCard.getByRole('button', { name: 'Vote (0)' })
  await expect(voteButton).toBeEnabled()
  await voteButton.click()
  await expect(galleryCard.getByRole('button', { name: '✓ Voted (1)' })).toBeDisabled()

  // Confirm the vote persisted server-side (not just local component state)
  // by reloading fresh and checking voted_by_me still comes back true.
  await page.goto('/')
  await page.getByRole('button', { name: 'Favorite Photo' }).click()
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
})
