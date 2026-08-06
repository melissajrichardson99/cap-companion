import { test, expect } from '@playwright/test'

// Covers QR/manual-code scanning (migration 009_scan_codes.sql): manual code
// entry resolving both a hunt_character and an encyclopedia_entry, an
// unknown code showing a clear "not found" state, and /scan/:code working as
// a hard direct deep link (page.goto straight to the URL, simulating someone
// else's camera app opening it fresh rather than in-app navigation).
//
// Deliberately never answers/advances a Hunt challenge here -- only asserts
// the modal opened on the right character -- so this file doesn't mutate
// hunt_progress and can run in any order relative to scavenger-hunt.spec.ts,
// which assumes every character starts at 0/3.

test.describe('QR / manual code scanning', () => {
  test('manual entry resolves a hunt_character code into that character\'s challenge flow', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Scan QR' }).click()

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Or enter the code from the sign').fill('brave-otter')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByText('Kangaroo — Challenge 1')).toBeVisible()
    await expect(page).toHaveURL(/\/scan\/brave-otter$/)
  })

  test('manual entry is case-insensitive and whitespace-tolerant', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Scan QR' }).click()

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Or enter the code from the sign').fill('  Brave Otter  ')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByText('Kangaroo — Challenge 1')).toBeVisible()
  })

  test('manual entry resolves an encyclopedia_entry code into the "coming soon" stub', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Scan QR' }).click()

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Or enter the code from the sign').fill('jolly-zebra')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByRole('heading', { name: 'Red Panda' })).toBeVisible()
    await expect(page.getByText('Coming soon!')).toBeVisible()
  })

  test('an unknown code shows a clear not-found state, not a broken page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Scan QR' }).click()

    const modal = page.locator('.modal-panel')
    await modal.getByLabel('Or enter the code from the sign').fill('totally-bogus-code')
    await modal.getByRole('button', { name: 'Go' }).click()

    await expect(page.getByText(/couldn't find a code matching/i)).toBeVisible()
    await page.getByRole('button', { name: 'Back to the app' }).click()
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
    await expect(page.getByRole('button', { name: 'Scan QR' })).toBeVisible()
  })

  test('/scan/:code deep link for an unknown code also shows not-found, not a crash', async ({ page }) => {
    await page.goto('/scan/nonexistent-code')
    await expect(page.getByText(/couldn't find a code matching/i)).toBeVisible()
  })
})
