import { test, expect, type APIRequestContext } from '@playwright/test'
import { seedDeviceSession, withSession } from './deviceSessionHelper'

// Guest Accounts Phase 1 -- Cobb Coins + Collectibles as lifetime account
// totals (migration 036_guest_accounts_lifetime_coins_collectibles.sql).
// Complements frontend/e2e/guest-accounts.spec.ts (Phase 0's signup/login/
// logout round trip) and cobb-coins.spec.ts/collectible-cards.spec.ts
// (anonymous, per-device-session behavior -- deliberately untouched by this
// phase and not re-tested here). Covers exactly the behaviors the ticket
// calls out as needing explicit verification: folding a visit's already-
// earned coins into the lifetime total on login, two-guest isolation, and
// Reset Session on a logged-in device (logout here, lifetime data survives,
// a later login restores it) -- the one behavior most likely to have a
// subtle bug, per the ticket, given how much it diverges from today's
// anonymous Reset Session.

const API = 'http://localhost:8000'

function uniqueEmail(): string {
  return `guest-lifetime-${crypto.randomUUID()}@example.com`
}

const PASSWORD = 'correct horse battery staple'

// Second arg to a raw request call -- attaches both the device session token
// every endpoint requires and, optionally, a guest auth token, mirroring how
// api.ts's request() rides X-Guest-Auth along whenever one is stored.
function withGuestSession(deviceToken: string, guestToken?: string): { headers: Record<string, string> } {
  const headers: Record<string, string> = { 'X-Device-Session': deviceToken }
  if (guestToken) headers['X-Guest-Auth'] = guestToken
  return { headers }
}

async function resetSessionApi(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.post(`${API}/session/reset`, withSession(token))
  expect(res.ok()).toBe(true)
}

async function signup(request: APIRequestContext, deviceToken: string, email: string): Promise<string> {
  const res = await request.post(`${API}/account/signup`, {
    ...withSession(deviceToken),
    data: { email, password: PASSWORD },
  })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { token: string }
  return body.token
}

async function login(request: APIRequestContext, deviceToken: string, email: string): Promise<string> {
  const res = await request.post(`${API}/account/login`, {
    ...withSession(deviceToken),
    data: { email, password: PASSWORD },
  })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { token: string }
  return body.token
}

async function getCoinsTotal(request: APIRequestContext, deviceToken: string, guestToken?: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withGuestSession(deviceToken, guestToken))
  const body = (await res.json()) as { total: number }
  return body.total
}

let cachedChallengeId: string | null = null

async function getFirstPuzzleChallengeId(request: APIRequestContext): Promise<string> {
  if (cachedChallengeId) return cachedChallengeId
  const res = await request.get(`${API}/puzzles`)
  const puzzles = (await res.json()) as { challenges: { id: string }[] }[]
  cachedChallengeId = puzzles[0].challenges[0].id
  return cachedChallengeId
}

// Deterministic, idempotency-guard-free coin earn (see
// app/services/puzzles.py's record_attempt -- every attempt awards coins,
// no one-time guard to work around) -- 12/9/6/3 coins for 0/1/2/3 hints used.
async function earnCoinsViaPuzzle(request: APIRequestContext, deviceToken: string, hintsUsed: 0 | 1 | 2 | 3): Promise<void> {
  const challengeId = await getFirstPuzzleChallengeId(request)
  const res = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
    ...withSession(deviceToken),
    data: { elapsed_seconds: 10, hints_used: hintsUsed },
  })
  expect(res.ok()).toBe(true)
}

test.describe('Guest Accounts Phase 1 -- lifetime Coins/Collectibles', () => {
  test('signing up mid-visit folds already-earned coins into the lifetime total, and logging in on a second device joins it to the same total', async ({
    request,
  }) => {
    const email = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await earnCoinsViaPuzzle(request, tokenA, 0) // +12, anonymous so far

    // Anonymous total on device A before signing up.
    expect(await getCoinsTotal(request, tokenA)).toBe(12)

    const guestTokenA = await signup(request, tokenA, email)

    // Signing up links device A to the new guest in the same request -- no
    // separate merge step -- so the lifetime view (with the guest header)
    // already includes what was earned before signing up.
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(12)

    // A second, brand new device: anonymous and earns its own coins first.
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenB)
    await earnCoinsViaPuzzle(request, tokenB, 1) // +9
    expect(await getCoinsTotal(request, tokenB)).toBe(9)

    // Logging in (not signing up) on device B links it to the SAME guest.
    const guestTokenB = await login(request, tokenB, email)

    // Device B's lifetime view now spans both devices...
    expect(await getCoinsTotal(request, tokenB, guestTokenB)).toBe(12 + 9)
    // ...and so does device A's, using its own still-valid guest token.
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(12 + 9)
  })

  test('two different logged-in guests never see each other\'s lifetime totals', async ({ request }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, emailA)
    await earnCoinsViaPuzzle(request, tokenA, 0) // +12, after linking

    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenB)
    const guestTokenB = await signup(request, tokenB, emailB)
    await earnCoinsViaPuzzle(request, tokenB, 2) // +6, after linking

    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(12)
    expect(await getCoinsTotal(request, tokenB, guestTokenB)).toBe(6)

    // Cross-check with the wrong token pairing changes nothing -- each
    // guest's total is keyed off their own linked sessions only.
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).not.toBe(await getCoinsTotal(request, tokenB, guestTokenB))
  })

  test('Reset Session on a linked device unlinks/logs out that specific guest token without affecting the guest\'s lifetime total or their other devices', async ({
    request,
  }) => {
    const email = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)
    await earnCoinsViaPuzzle(request, tokenA, 0) // +12

    // A second device, also linked to the same guest, kept logged in
    // throughout -- proves the reset below only logs out device A.
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenB)
    const guestTokenB = await login(request, tokenB, email)
    await earnCoinsViaPuzzle(request, tokenB, 1) // +9

    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(21)

    // Reset device A while sending its guest token, exactly as api.ts's
    // request() would (X-Guest-Auth rides along automatically whenever one
    // is stored).
    const resetRes = await request.post(`${API}/session/reset`, withGuestSession(tokenA, guestTokenA))
    expect(resetRes.ok()).toBe(true)
    const resetBody = (await resetRes.json()) as { guest_logged_out: boolean; coins_reset: number }
    expect(resetBody.guest_logged_out).toBe(true)
    // Nothing was deleted -- the guest's history survives via this (now
    // retired) session's still-set guest_id, not by copying rows elsewhere.
    expect(resetBody.coins_reset).toBe(0)

    // Device A's own now-invalidated guest token no longer authenticates an
    // account-specific endpoint...
    const whoamiRes = await request.get(`${API}/account/whoami`, { headers: { 'X-Guest-Auth': guestTokenA } })
    expect(whoamiRes.status()).toBe(401)

    // ...but device B is completely unaffected -- still logged in, and its
    // lifetime view still sees the full, unaffected total.
    expect(await getCoinsTotal(request, tokenB, guestTokenB)).toBe(21)

    // Logging in again (even on the very same, now-anonymous device A)
    // restores the full lifetime total.
    const guestTokenA2 = await login(request, tokenA, email)
    expect(await getCoinsTotal(request, tokenA, guestTokenA2)).toBe(21)
  })

  test('after Reset Session logs a guest out, a DIFFERENT anonymous person picking up the same device cannot see or contribute to that guest\'s lifetime total', async ({
    request,
  }) => {
    // Distinct from the test above -- that one re-establishes the SAME guest
    // on the SAME retired token. This one specifically models the kiosk
    // handoff: a different, anonymous physical person now uses the device,
    // via a brand new token (exactly what deviceSession.ts's
    // rotateDeviceSessionId produces), with no guest header at all.
    const email = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)
    await earnCoinsViaPuzzle(request, tokenA, 0) // +12
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(12)

    const resetRes = await request.post(`${API}/session/reset`, withGuestSession(tokenA, guestTokenA))
    const resetBody = (await resetRes.json()) as { guest_logged_out: boolean }
    expect(resetBody.guest_logged_out).toBe(true)

    // The next person's device session -- a brand new token, exactly what
    // rotateDeviceSessionId() mints, with NO X-Guest-Auth header at all.
    const tokenNext = crypto.randomUUID()
    await earnCoinsViaPuzzle(request, tokenNext, 1) // +9, purely anonymous

    // Their own (session-scoped) total sees only their own 9.
    expect(await getCoinsTotal(request, tokenNext)).toBe(9)

    // Adversarial case: even if guest A's now-invalidated token somehow rode
    // along with the new person's request, it must not grant guest A's
    // total -- get_optional_guest treats an invalid token as anonymous, so
    // this must still read as session-scoped (9), not guest A's lifetime.
    expect(await getCoinsTotal(request, tokenNext, guestTokenA)).toBe(9)

    // The decisive check, in the other direction: guest A's lifetime total,
    // read via an entirely independent login (a third token, as if on a
    // later visit -- never touches tokenNext at all), must be exactly the
    // 12 they actually earned -- NOT 21. Since the lifetime total is the sum
    // over every device_sessions row with guest_id = guest A (see
    // app/services/coins.py's get_total), the only way this could read 21
    // instead of 12 is if tokenNext's row had somehow been linked to guest
    // A -- which nothing in this test ever did. This is the direct proof
    // that the new anonymous session's device_sessions.guest_id is NOT
    // guest A's, without needing DB access from this suite.
    const tokenC = crypto.randomUUID()
    const guestTokenA2 = await login(request, tokenC, email)
    expect(await getCoinsTotal(request, tokenC, guestTokenA2)).toBe(12)

    // And guest A's own history (via the original, now-retired session) is
    // still fully theirs and unaffected -- checked from yet another angle.
    expect(await getCoinsTotal(request, tokenA, guestTokenA2)).toBe(12)
  })

  test('Reset Session on a logged-in device logs the guest out in the UI and a later login restores their Cobb Coins', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    const email = uniqueEmail()
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)

    await page.goto('/')
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()

    // Earn coins on this now-linked session via raw HTTP (deterministic,
    // no UI needed) and confirm the nav reflects the lifetime total.
    await earnCoinsViaPuzzle(request, token, 0) // +12
    await page.reload()
    await page.getByRole('button', { name: /Open menu/ }).click()
    await expect(page.locator('.nav-menu-coins')).toHaveText('🪙 12 Cobb Coins')

    const guestTokenBeforeReset = await page.evaluate(() => localStorage.getItem('cap-guest-auth-token'))
    expect(guestTokenBeforeReset).toBeTruthy()

    // Reset Session -- the confirm dialog calls out that this also logs the
    // guest out, then confirm.
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reset Session' })
    await expect(dialog.getByText(email, { exact: false })).toBeVisible()
    await dialog.getByRole('button', { name: 'Reset Session' }).click()
    await expect(dialog).toHaveCount(0)

    // Logged out here: the device rotated to a brand new, unlinked session
    // id, the stored guest token is gone, and the nav shows 0 / the
    // anonymous entry point again.
    const deviceTokenAfterReset = await page.evaluate(() => localStorage.getItem('cap-device-session-id'))
    expect(deviceTokenAfterReset).not.toBe(token)
    const guestTokenAfterReset = await page.evaluate(() => localStorage.getItem('cap-guest-auth-token'))
    expect(guestTokenAfterReset).toBeNull()
    await page.getByRole('button', { name: /Open menu/ }).click()
    await expect(page.locator('.nav-menu-coins')).toHaveText('🪙 0 Cobb Coins')
    await expect(page.getByRole('button', { name: 'Save Your Progress' })).toBeVisible()

    // The old guest token really was invalidated server-side, not just
    // forgotten client-side.
    const whoamiRes = await request.get(`${API}/account/whoami`, { headers: { 'X-Guest-Auth': guestTokenBeforeReset! } })
    expect(whoamiRes.status()).toBe(401)

    // Logging back in (on this same, now-anonymous device) restores the
    // lifetime total -- it was never touched by the reset above.
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByRole('heading', { name: 'Log In' })).not.toBeVisible()
    await page.getByRole('button', { name: /Open menu/ }).click()
    await expect(page.locator('.nav-menu-coins')).toHaveText('🪙 12 Cobb Coins')
  })
})
