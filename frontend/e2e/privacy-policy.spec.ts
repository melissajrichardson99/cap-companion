import { test, expect, type Page } from '@playwright/test'
import { PRIVACY_POLICY_CONTACT_EMAIL, PRIVACY_POLICY_LAST_UPDATED, PRIVACY_POLICY_SECTIONS } from '../src/privacyPolicyContent'

// Covers the Privacy Policy page (PrivacyScreen.tsx): a real, hard-reload-safe
// /privacy route rendering privacyPolicyContent.ts verbatim, plus its two
// discoverable entry points -- the nav menu's footer link (every guest page)
// and the Save Your Progress / account menu (the signup/login area).

async function openNavMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
}

test.describe('Privacy Policy page', () => {
  test('/privacy works as a direct hard-reload/deep link', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
    await expect(page.getByText(`Last updated: ${PRIVACY_POLICY_LAST_UPDATED}`)).toBeVisible()
  })

  test('reachable via the nav menu footer link', async ({ page }) => {
    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('button', { name: 'Privacy Policy' }).click()
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/privacy')
  })

  test('reachable via the Save Your Progress account menu', async ({ page }) => {
    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    const heading = page.getByRole('heading', { name: 'Save Your Progress', exact: true })
    await expect(heading).toBeVisible()
    // NavMenu's own panel (with its own "Privacy Policy" footer link) stays
    // mounted behind the modal even while closed -- scope to the modal
    // dialog so this doesn't match both.
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
