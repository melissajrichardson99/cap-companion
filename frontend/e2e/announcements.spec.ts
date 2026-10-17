import { test, expect, type Page } from '@playwright/test'
import { apiStaffLogin, loginAsStaff } from './staffAuthHelper'
import { openNavMenu } from './navMenuHelper'

// Every announcement this file creates is prefixed so afterEach can clean up
// by content match alone, regardless of which test (or a failed one) created
// it -- keeps this file from leaking undismissed announcements into other
// spec files, which would otherwise pop the guest-facing popup open on their
// very first page.goto('/') and block unrelated UI interactions. Belt-and-
// suspenders: reset_demo_data.py (global-setup.ts) also wipes this table, so
// even a cleanup that itself fails here can't poison a *later* full run.
const TEST_PREFIX = 'E2E Announcement'

function uniqueText(label: string): string {
  return `${TEST_PREFIX} ${Date.now()} ${label}`
}

async function openAnnouncementsTab(staffPage: Page) {
  await staffPage.getByRole('tab', { name: 'Announcements' }).click()
}

async function createAnnouncement(staffPage: Page, text: string) {
  await openAnnouncementsTab(staffPage)
  await staffPage.getByLabel('New Announcement').fill(text)
  await staffPage.getByRole('button', { name: 'Post Announcement' }).click()
  await expect(staffPage.locator('.staff-announcement-row', { hasText: text })).toBeVisible()
}

function announcementPopup(page: Page) {
  return page.getByRole('dialog', { name: 'Announcement' })
}

// Raw API calls via Playwright's `request` fixture (no browser page/UI
// involved) -- fast and independent of any page's state, so this cleanup
// can't itself get stuck behind a stray popup or dialog the way a
// UI-driven (loginAsStaff + page.evaluate) approach could.
test.afterEach(async ({ request }) => {
  const token = await apiStaffLogin(request)
  const res = await request.get('http://localhost:8000/announcements')
  const rows: { id: string; text: string }[] = await res.json()
  await Promise.all(
    rows
      .filter((r) => r.text.startsWith(TEST_PREFIX))
      .map((r) =>
        request.delete(`http://localhost:8000/announcements/${r.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
  )
})

test('staff creates an announcement -> it shows in the Home Page box and the popup appears for a fresh guest load', async ({
  page,
  context,
}) => {
  const text = uniqueText('Capybara Meet & Greet')

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await createAnnouncement(staffPage, text)

  await page.goto('/')
  await expect(page.locator('.home-announcement-item', { hasText: text })).toBeVisible()

  const popup = announcementPopup(page)
  await expect(popup).toBeVisible()
  await expect(popup).toContainText(text)
})

test('editing updates the Home Page box and popup content; deleting removes both', async ({ page, context }) => {
  // updatedText is deliberately a wholly different phrase (not a superstring
  // of originalText) -- a substring-based hasText locator for originalText
  // would otherwise still match the edited row if updatedText just appended
  // to it (e.g. "... (Updated)"), silently defeating the "removed" assertion.
  const originalText = uniqueText('Petting Zoo Extended Hours')
  const updatedText = uniqueText('Splash Pad Reopens Saturday')

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await createAnnouncement(staffPage, originalText)

  const row = staffPage.locator('.staff-announcement-row', { hasText: originalText })
  await row.getByRole('button', { name: 'Edit' }).click()
  // Not `row` from here on: entering edit mode swaps the row's content to a
  // <textarea> (its .value isn't part of textContent), so a locator keyed
  // on the original label text stops matching the row entirely once edited.
  const editingRow = staffPage.locator('.staff-announcement-edit')
  await editingRow.locator('.staff-announcement-textarea').fill(updatedText)
  await editingRow.getByRole('button', { name: 'Save' }).click()
  await expect(staffPage.locator('.staff-announcement-row', { hasText: updatedText })).toBeVisible()

  await page.goto('/')
  await expect(page.locator('.home-announcement-item', { hasText: updatedText })).toBeVisible()
  await expect(page.locator('.home-announcement-item', { hasText: originalText })).toHaveCount(0)
  await expect(announcementPopup(page)).toContainText(updatedText)

  staffPage.on('dialog', (dialog) => dialog.accept())
  const updatedRow = staffPage.locator('.staff-announcement-row', { hasText: updatedText })
  await updatedRow.getByRole('button', { name: 'Delete' }).click()
  await expect(staffPage.locator('.staff-announcement-row', { hasText: updatedText })).toHaveCount(0)

  await page.goto('/')
  await expect(page.locator('.home-announcement-item', { hasText: updatedText })).toHaveCount(0)
  await expect(announcementPopup(page)).toHaveCount(0)
})

test('dismissal is per-announcement: dismissing one never suppresses another or a later new one, and Reset Session clears dismissed state', async ({
  page,
  context,
}) => {
  const textA = uniqueText('A - Zoo Keeper Talk')
  const textB = uniqueText('B - New Splash Pad Open')

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await createAnnouncement(staffPage, textA)
  await createAnnouncement(staffPage, textB)

  await page.goto('/')
  const popup = announcementPopup(page)
  // Newest first: B (created after A) shows first.
  await expect(popup).toContainText(textB)
  await popup.getByRole('button', { name: 'Got it' }).click()
  // Dismissing B must not suppress the still-undismissed A -- proves
  // per-announcement tracking, not a single boolean flag.
  await expect(popup).toContainText(textA)

  await popup.getByRole('button', { name: 'Got it' }).click()
  await expect(popup).toHaveCount(0)

  // A guest reload after dismissing both must not resurrect either.
  await page.reload()
  await expect(announcementPopup(page)).toHaveCount(0)

  // A brand-new announcement, created after the guest dismissed everything
  // that existed so far, must still appear -- proves dismissal keys off
  // announcement id, not "has this guest ever dismissed anything."
  const textC = uniqueText('C - Fresh Announcement After Dismissal')
  await createAnnouncement(staffPage, textC)
  await page.goto('/')
  const popupAfterC = announcementPopup(page)
  await expect(popupAfterC).toContainText(textC)
  await expect(popupAfterC).not.toContainText(textA)
  await expect(popupAfterC).not.toContainText(textB)
  await popupAfterC.getByRole('button', { name: 'Got it' }).click()
  await expect(announcementPopup(page)).toHaveCount(0)

  // Reset Session (NavMenu -> Reset Session -> confirm) clears the shared
  // kiosk's dismissed-ids state -- previously-dismissed announcements (all
  // three still exist in the DB) must reappear without a full page reload.
  await openNavMenu(page)
  await page.getByRole('button', { name: 'Reset Session' }).click()
  const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
  await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
  // Scoped by name, not a bare getByRole('dialog') -- the announcement
  // popup (also role="dialog") can legitimately reappear immediately once
  // Reset Session clears the dismissed-ids state, so "some dialog is open"
  // isn't the right thing to assert false here, only this specific one.
  await expect(resetConfirmDialog).toHaveCount(0)

  await expect(announcementPopup(page)).toBeVisible()
})

test('editing re-triggers the popup for a guest who already dismissed the original text, without duplicating the announcement', async ({
  page,
  context,
}) => {
  const originalText = uniqueText('Otter Feeding Moved to 2pm')
  const updatedText = uniqueText('Otter Feeding Moved to 3pm')

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await createAnnouncement(staffPage, originalText)

  await page.goto('/')
  const popup = announcementPopup(page)
  await expect(popup).toContainText(originalText)
  await popup.getByRole('button', { name: 'Got it' }).click()
  await expect(announcementPopup(page)).toHaveCount(0)

  // Stays dismissed across a plain reload until it's actually edited.
  await page.reload()
  await expect(announcementPopup(page)).toHaveCount(0)

  const row = staffPage.locator('.staff-announcement-row', { hasText: originalText })
  await row.getByRole('button', { name: 'Edit' }).click()
  const editingRow = staffPage.locator('.staff-announcement-edit')
  await editingRow.locator('.staff-announcement-textarea').fill(updatedText)
  await editingRow.getByRole('button', { name: 'Save' }).click()
  // The edit form only closes once the PATCH has returned. Wait for that
  // rather than for the row text below, which already matches while the
  // textarea still holds the new text -- otherwise the guest's reload can
  // race the save (and with the backend's announcements cache, a reload that
  // lands before the write is answered instantly with the pre-edit row).
  await expect(editingRow).toHaveCount(0)

  // Still one row, same announcement -- editing must never create a second.
  await expect(staffPage.locator('.staff-announcement-row', { hasText: updatedText })).toHaveCount(1)

  // The edit bumped updated_at server-side, so this guest's prior dismissal
  // (keyed off id + updated_at, not id alone) no longer matches -- the
  // popup must reappear with the new text on next page load, with no
  // Reset Session involved.
  await page.goto('/')
  const popupAfterEdit = announcementPopup(page)
  await expect(popupAfterEdit).toContainText(updatedText)
  await expect(page.locator('.home-announcement-item', { hasText: updatedText })).toHaveCount(1)

  // Dismissing the edited version is sticky again until it's edited once more.
  await popupAfterEdit.getByRole('button', { name: 'Got it' }).click()
  await page.reload()
  await expect(announcementPopup(page)).toHaveCount(0)
})

test('the "Post Announcement" and "Got it" buttons render the app brand orange, not the unstyled purple accent', async ({
  page,
  context,
}) => {
  const text = uniqueText('Color Check')
  const BRAND_ORANGE = 'rgb(243, 134, 48)' // --cap-color-sunset-orange (#f38630)

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await openAnnouncementsTab(staffPage)

  const postButton = staffPage.getByRole('button', { name: 'Post Announcement' })
  expect(await postButton.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(BRAND_ORANGE)

  await createAnnouncement(staffPage, text)

  await page.goto('/')
  const gotItButton = announcementPopup(page).getByRole('button', { name: 'Got it' })
  expect(await gotItButton.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(BRAND_ORANGE)
  await gotItButton.click()
})

test('a real guest deep-link entry (not in-app nav) shows the popup, portaled outside any screen root with correct stacking', async ({
  page,
  context,
}) => {
  const text = uniqueText('Deep Link Coverage Check')

  const staffPage = await context.newPage()
  await loginAsStaff(staffPage)
  await createAnnouncement(staffPage, text)

  // A hard deep link, same as a QR sign a real guest's camera app would
  // open -- this app has a documented history of the normal in-app-nav path
  // and this kind of direct entry silently diverging.
  await page.goto('/animals/capybara')
  const popup = announcementPopup(page)
  await expect(popup).toBeVisible()
  await expect(popup).toContainText(text)

  // Real computed styles, not just class presence: the portal target must
  // be a direct child of document.body (proving createPortal actually
  // escaped AnimalsScreen's own `isolation: isolate` foliage root, which
  // would otherwise cage its stacking context), fixed-positioned, and
  // resolve to the intended z-index.
  const backdrop = page.locator('.announcement-popup-backdrop')
  const stacking = await backdrop.evaluate((el) => ({
    isDirectBodyChild: el.parentElement === document.body,
    position: getComputedStyle(el).position,
    zIndex: getComputedStyle(el).zIndex,
  }))
  expect(stacking.isDirectBodyChild).toBe(true)
  expect(stacking.position).toBe('fixed')
  expect(stacking.zIndex).toBe('250')
})
