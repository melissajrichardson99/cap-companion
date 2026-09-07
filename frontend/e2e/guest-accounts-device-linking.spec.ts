import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { withSession } from './deviceSessionHelper'

// Guest Accounts Phase 5 (final gate) -- the critical edge case explicitly
// called out for this phase's security review: re-authenticating as a
// DIFFERENT guest on a device session that's already linked, without Reset
// Session first. Before this phase, app/services/guest_accounts.py's
// _link_device_session unconditionally overwrote device_sessions.guest_id --
// since every lifetime Coins/Collectibles/Bingo/Map read is a live join over
// "every session currently linked to me" (app/device_session.py's
// list_guest_session_ids), a second guest logging in (or signing up) on the
// same device would silently and permanently detach whatever that session
// had contributed from the first guest's lifetime total. This suite proves
// the fix: guest_accounts.py's _reject_if_linked_to_a_different_guest.

const API = 'http://localhost:8000'

function uniqueEmail(): string {
  return `guest-linking-${crypto.randomUUID()}@example.com`
}

const PASSWORD = 'correct horse battery staple'

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

function withGuestSession(deviceToken: string, guestToken?: string): { headers: Record<string, string> } {
  const headers: Record<string, string> = { 'X-Device-Session': deviceToken }
  if (guestToken) headers['X-Guest-Auth'] = guestToken
  return { headers }
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

async function earnCoinsViaPuzzle(request: APIRequestContext, deviceToken: string): Promise<void> {
  const challengeId = await getFirstPuzzleChallengeId(request)
  const res = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
    ...withSession(deviceToken),
    data: { elapsed_seconds: 10, hints_used: 0 },
  })
  expect(res.ok()).toBe(true)
}

test.describe('Guest Accounts Phase 5 -- device-link protection against a second guest overwriting the first', () => {
  test('logging in as a different guest on an already-linked device is rejected (409) and does not touch the linked guest\'s lifetime total', async ({
    request,
  }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    // Guest B needs to already exist to be "logged in as" below.
    const tokenBSetup = crypto.randomUUID()
    await resetSessionApi(request, tokenBSetup)
    await signup(request, tokenBSetup, emailB)

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, emailA)
    await earnCoinsViaPuzzle(request, tokenA) // +12, attributed to guest A

    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(12)

    // Attempt to log in as guest B on the SAME device session, with no
    // Reset Session / logout in between -- must be rejected outright.
    const loginAsBRes = await request.post(`${API}/account/login`, {
      ...withSession(tokenA),
      data: { email: emailB, password: PASSWORD },
    })
    expect(loginAsBRes.status()).toBe(409)

    // Guest A's lifetime total is completely unaffected -- the whole point
    // of the guard.
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(12)

    // whoami with guest A's still-valid token confirms the device is still
    // genuinely linked to A, not silently repointed at B.
    const whoamiRes = await request.get(`${API}/account/whoami`, { headers: { 'X-Guest-Auth': guestTokenA } })
    expect(whoamiRes.ok()).toBe(true)
  })

  test('a plain Log Out (not Reset Session) does not free the device for a different guest to log in', async ({ request }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    const tokenBSetup = crypto.randomUUID()
    await resetSessionApi(request, tokenBSetup)
    await signup(request, tokenBSetup, emailB)

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, emailA)

    // Plain logout -- deletes only the guest_auth_tokens row (guest_accounts.py's
    // logout()); it deliberately does NOT unlink device_sessions.guest_id.
    const logoutRes = await request.post(`${API}/account/logout`, { headers: { 'X-Guest-Auth': guestTokenA } })
    expect(logoutRes.ok()).toBe(true)

    const loginAsBRes = await request.post(`${API}/account/login`, {
      ...withSession(tokenA),
      data: { email: emailB, password: PASSWORD },
    })
    expect(loginAsBRes.status()).toBe(409)
  })

  test('re-authenticating as the SAME already-linked guest still works normally (no false positive)', async ({ request }) => {
    const email = uniqueEmail()
    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const logoutRes = await request.post(`${API}/account/logout`, { headers: { 'X-Guest-Auth': guestTokenA } })
    expect(logoutRes.ok()).toBe(true)

    const reloginRes = await request.post(`${API}/account/login`, {
      ...withSession(tokenA),
      data: { email, password: PASSWORD },
    })
    expect(reloginRes.ok()).toBe(true)
  })

  test('a wrong-password attempt against a different linked guest still gets the generic credential error, not the device-link error', async ({
    request,
  }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    const tokenBSetup = crypto.randomUUID()
    await resetSessionApi(request, tokenBSetup)
    await signup(request, tokenBSetup, emailB)

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await signup(request, tokenA, emailA)

    // Credentials are checked before the device-link guard -- a wrong
    // password must not leak "there's a different account linked here".
    const res = await request.post(`${API}/account/login`, {
      ...withSession(tokenA),
      data: { email: emailB, password: 'the wrong password' },
    })
    expect(res.status()).toBe(401)
    const body = (await res.json()) as { detail: string }
    expect(body.detail).toBe('Invalid email or password')
  })

  test('signing up for a brand new account on an already-linked device is rejected (409), and the row is never created', async ({
    request,
  }) => {
    const emailA = uniqueEmail()
    const emailNew = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await signup(request, tokenA, emailA)

    const signupRes = await request.post(`${API}/account/signup`, {
      ...withSession(tokenA),
      data: { email: emailNew, password: PASSWORD },
    })
    expect(signupRes.status()).toBe(409)

    // The new email was never actually registered -- confirmed by a clean
    // signup for it succeeding on a fresh, unlinked device.
    const freshToken = crypto.randomUUID()
    const freshSignupRes = await request.post(`${API}/account/signup`, {
      ...withSession(freshToken),
      data: { email: emailNew, password: PASSWORD },
    })
    expect(freshSignupRes.ok()).toBe(true)
  })

  test('after Reset Session, a different guest CAN log in on the device via the fresh, unlinked session token it rotates to', async ({
    request,
  }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    const tokenBSetup = crypto.randomUUID()
    await resetSessionApi(request, tokenBSetup)
    await signup(request, tokenBSetup, emailB)

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, emailA)

    const resetRes = await request.post(`${API}/session/reset`, withGuestSession(tokenA, guestTokenA))
    expect(resetRes.ok()).toBe(true)

    // The frontend rotates to a brand new, unlinked token here
    // (deviceSession.ts's rotateDeviceSessionId) -- simulate that.
    const tokenANext = crypto.randomUUID()
    const loginAsBRes = await request.post(`${API}/account/login`, {
      ...withSession(tokenANext),
      data: { email: emailB, password: PASSWORD },
    })
    expect(loginAsBRes.ok()).toBe(true)
  })
})

// Guest Accounts Phase 5 follow-up -- the API-level 409 above is correct but
// gave a real guest no clue *why* or what to do about it (Reset Session
// specifically, not the Log Out they'd try first). These drive the actual
// browser flow to confirm the explanatory copy and its Reset Session
// shortcut both show up in the rejection state, for both signup and login.
test.describe('Guest Accounts Phase 5 follow-up -- device-link conflict messaging', () => {
  async function openAccountModal(page: Page) {
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
  }

  async function signUpAndPlainLogOut(page: Page, email: string): Promise<void> {
    await openAccountModal(page)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()

    // Plain Log Out -- deliberately does NOT unlink this device, so the
    // conflict below is genuinely reachable this way (not just via Reset).
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: email }).click()
    await page.getByRole('button', { name: 'Log Out' }).click()
  }

  function assertConflictMessagingVisible(page: Page) {
    return Promise.all([
      expect(page.getByText(/currently signed in to a different account/)).toBeVisible(),
      expect(page.getByText(/completely safe/)).toBeVisible(),
      expect(page.getByText(/not.*delete or affect the other account/)).toBeVisible(),
    ])
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()
  })

  test('signing up as a new guest on an already-linked device shows the explanation and a Reset Session shortcut', async ({
    page,
  }) => {
    await signUpAndPlainLogOut(page, uniqueEmail())

    await openAccountModal(page)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(uniqueEmail())
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()

    await assertConflictMessagingVisible(page)

    // The shortcut opens Reset Session directly, without hunting for it in
    // the nav menu. Scoped to the open dialog -- the nav menu (still in the
    // DOM behind it, just visually hidden) has its own same-named button.
    await page.getByRole('dialog').getByRole('button', { name: 'Reset Session' }).click()
    await expect(page.getByRole('heading', { name: 'Reset Session' })).toBeVisible()
  })

  test('logging in as a different existing guest on an already-linked device shows the explanation', async ({
    page,
  }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    // Guest B needs to already exist to be logged in as below -- create it
    // in a separate, throwaway browser context so it doesn't touch this
    // page's own device session.
    const otherContext = await page.context().browser()!.newContext()
    const otherPage = await otherContext.newPage()
    await otherPage.goto('/')
    await openAccountModal(otherPage)
    await otherPage.getByRole('button', { name: 'Sign Up' }).click()
    await otherPage.getByPlaceholder('Email').fill(emailB)
    await otherPage.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await otherPage.getByRole('button', { name: 'Sign Up' }).click()
    await expect(otherPage.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()
    await otherContext.close()

    await signUpAndPlainLogOut(page, emailA)

    await openAccountModal(page)
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.getByPlaceholder('Email').fill(emailB)
    await page.getByPlaceholder('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()

    await assertConflictMessagingVisible(page)
  })
})
