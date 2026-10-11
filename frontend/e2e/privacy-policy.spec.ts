import { test, expect } from '@playwright/test'
import { openNavMenu } from './navMenuHelper'
import { PRIVACY_POLICY_CONTACT_EMAIL, PRIVACY_POLICY_LAST_UPDATED, PRIVACY_POLICY_SECTIONS } from '../src/privacyPolicyContent'

// Covers the Privacy Policy page (PrivacyScreen.tsx): a real, hard-reload-safe
// /privacy route rendering privacyPolicyContent.ts verbatim, plus its two
// discoverable entry points -- the main nav menu's primary tab list, same
// tier as FAQ (PIPA "Openness": reachable from every guest page, not nested
// in a specific feature's flow), and the Save Your Progress / account menu
// (the signup/login area, contextually useful right where personal
// information is being collected).


test.describe('Privacy Policy page', () => {
  test('/privacy works as a direct hard-reload/deep link', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
    await expect(page.getByText(`Last updated: ${PRIVACY_POLICY_LAST_UPDATED}`)).toBeVisible()
  })

  test('reachable via the main nav menu, same tier as FAQ', async ({ page }) => {
    await page.goto('/')
    await openNavMenu(page)
    // Privacy Policy is a primary tab (role="menuitemradio", same as FAQ and
    // every other primary page) -- not the old low-emphasis footer link --
    // so it's genuinely discoverable from any guest page, per PIPA
    // "Openness", not just reachable if you already know to look inside the
    // account flow.
    await page.getByRole('menuitemradio', { name: 'Privacy Policy' }).click()
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/privacy')
  })

  test('Privacy Policy tab is present on every guest screen, not nested in a specific flow', async ({ page }) => {
    for (const path of ['/', '/map', '/bingo', '/faq']) {
      await page.goto(path)
      await openNavMenu(page)
      await expect(page.getByRole('menuitemradio', { name: 'Privacy Policy' })).toBeVisible()
      // Close the menu before navigating to the next path so it doesn't
      // stay open across page.goto (a fresh load remounts it closed anyway,
      // but this keeps each iteration's state explicit).
      await page.keyboard.press('Escape')
    }
  })

  test('reachable via the Save Your Progress account menu', async ({ page }) => {
    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    const heading = page.getByRole('heading', { name: 'Save Your Progress', exact: true })
    await expect(heading).toBeVisible()
    // Scoped to the modal dialog -- NavMenu's panel (with its own "Privacy
    // Policy" tile) stays mounted behind it, though hidden while closed.
    const modal = page.getByRole('dialog')
    await modal.getByRole('button', { name: 'Privacy Policy' }).click()
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/privacy')
  })

  test('renders every top-level section heading and the corrected contact email', async ({ page }) => {
    await page.goto('/privacy')
    for (const section of PRIVACY_POLICY_SECTIONS) {
      if (section.heading) {
        await expect(page.getByRole('heading', { name: section.heading, exact: true })).toBeVisible()
      }
      for (const sub of section.subsections ?? []) {
        await expect(page.getByRole('heading', { name: sub.heading, exact: true })).toBeVisible()
      }
    }
    await expect(page.getByText(PRIVACY_POLICY_CONTACT_EMAIL)).toBeVisible()
    await expect(page.getByText('info@cobbsadventurepark.ca')).toHaveCount(0)
  })

  test('no horizontal overflow at desktop or mobile widths', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/privacy')
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    }
  })
})
