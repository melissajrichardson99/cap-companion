import type { Page } from '@playwright/test'

// Per-Device Sessions Phase 1 -- every backend endpoint Coins/Collectibles
// e2e specs hit now requires an X-Device-Session header (see
// backend/app/device_session.py's get_or_create_session, a 400 if missing).
// Raw Playwright `request.*()` calls never go through the frontend's own
// api.ts (which attaches this header automatically via
// frontend/src/deviceSession.ts's getDeviceSessionId()), so every raw call
// in a test must explicitly attach one, and it must be the SAME token the
// test's own `page` is using, or the UI's displayed coin/collectible state
// won't match what the raw calls just did.

// Second arg to a raw request.get/post/patch(...) call, to attach a chosen
// device-session token instead of the (missing, since no browser storage
// exists here) frontend one.
export function withSession(token: string): { headers: Record<string, string> } {
  return { headers: { 'X-Device-Session': token } }
}

// Pre-seeds `page`'s localStorage with a chosen token *before* first
// navigation, so the frontend's own getDeviceSessionId() adopts this exact
// token instead of minting a random one -- this is what keeps `page`'s own
// fetches in sync with a test's raw `request.*()` calls using the same
// token via withSession() above. Must be called before page.goto().
export async function seedDeviceSession(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem('cap-device-session-id', t)
  }, token)
}
