import { test, expect } from '@playwright/test'

// Per-Device Sessions Phase 0 -- foundational plumbing only, no real feature
// depends on this yet. Exercises the whole round trip (frontend-generated
// token -> X-Device-Session header -> backend upsert-on-first-use) via the
// throwaway GET /session/whoami endpoint and its window.__capWhoami console
// hook (see main.tsx), since there's no guest-facing UI for this in Phase 0.

interface Whoami {
  id: string
  created_at: string
  last_active_at: string
}

async function whoami(page: import('@playwright/test').Page): Promise<Whoami> {
  await page.goto('/')
  // Wait for the app to actually be rendered (and past Vite's dev-server
  // cold-start auto-reload, which otherwise intermittently destroys the
  // execution context right as evaluate() below runs) before reaching for
  // the window.__capWhoami console hook.
  await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()
  return page.evaluate(() => window.__capWhoami())
}

test('two separate browser contexts get distinct device session ids', async ({ page, browser }) => {
  const deviceA = await whoami(page)

  const deviceBContext = await browser.newContext()
  const deviceBPage = await deviceBContext.newPage()
  const deviceB = await whoami(deviceBPage)
  await deviceBContext.close()

  expect(deviceA.id).not.toBe(deviceB.id)
})

test('a single context keeps the same device session id across a reload, and last_active_at advances', async ({ page }) => {
  const before = await whoami(page)

  await page.reload()
  const after: Whoami = await page.evaluate(() => window.__capWhoami())

  expect(after.id).toBe(before.id)
  expect(new Date(after.last_active_at).getTime()).toBeGreaterThanOrEqual(new Date(before.last_active_at).getTime())
})
