import { test, expect, type APIRequestContext } from '@playwright/test'
import { withSession } from './deviceSessionHelper'

// Regression test for the bug where Family Passport's total_cobb_coins was
// computed via app/services/coins.py's get_total(device_session_id) with no
// guest_id -- always the CALLING SESSION's own coin total, never the guest's
// true lifetime total across every linked session (see
// app/services/passport.py's _compute_stats / generate_passport). Three
// passports generated at different points in a guest's history all showed
// the same stale, session-scoped number instead of genuinely growing over
// time. Fixed by threading guest_id through to coins_service.get_total, same
// pattern Coins/Collectibles/Bingo/Map already use.

const API = 'http://localhost:8000'

function uniqueEmail(): string {
  return `guest-passport-${crypto.randomUUID()}@example.com`
}

const PASSWORD = 'correct horse battery staple'

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

let cachedChallengeId: string | null = null
async function getFirstPuzzleChallengeId(request: APIRequestContext): Promise<string> {
  if (cachedChallengeId) return cachedChallengeId
  const res = await request.get(`${API}/puzzles`)
  const puzzles = (await res.json()) as { challenges: { id: string }[] }[]
  cachedChallengeId = puzzles[0].challenges[0].id
  return cachedChallengeId
}

// Deterministic, idempotency-guard-free coin earn (see
// app/services/puzzles.py's record_attempt) -- 12/9/6/3 coins for
// 0/1/2/3 hints used, stackable any number of times.
async function earnCoinsViaPuzzle(
  request: APIRequestContext,
  deviceToken: string,
  guestToken: string,
  hintsUsed: 0 | 1 | 2 | 3,
): Promise<void> {
  const challengeId = await getFirstPuzzleChallengeId(request)
  const res = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
    ...withGuestSession(deviceToken, guestToken),
    data: { elapsed_seconds: 10, hints_used: hintsUsed },
  })
  expect(res.ok()).toBe(true)
}

interface PassportStats {
  total_cobb_coins: number
}

async function generatePassport(
  request: APIRequestContext,
  deviceToken: string,
  guestToken: string,
  familyLabel: string,
): Promise<PassportStats> {
  const res = await request.post(`${API}/passport/generate`, {
    ...withGuestSession(deviceToken, guestToken),
    multipart: { family_label: familyLabel },
  })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { stats: PassportStats }
  return body.stats
}

test.describe('Guest Accounts -- Family Passport lifetime coin total', () => {
  test('three passports generated at different points show correct, distinct lifetime totals -- not the same stale session-scoped number', async ({
    request,
  }) => {
    const email = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)
    await earnCoinsViaPuzzle(request, tokenA, guestTokenA, 0) // +12

    const passport1 = await generatePassport(request, tokenA, guestTokenA, 'The Smiths')
    expect(passport1.total_cobb_coins).toBe(12)

    // A second device, linked to the SAME guest via login (not signup) --
    // exactly the scenario the bug report described (passports generated
    // "at different times", implicitly across a real multi-visit history).
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenB)
    const guestTokenB = await login(request, tokenB, email)
    await earnCoinsViaPuzzle(request, tokenB, guestTokenB, 1) // +9

    // Generating from device B must see the FULL guest-wide total (12 + 9),
    // not device B's own session-scoped 9 -- this is the exact bug: before
    // the fix, this would have read 9 (or whatever this device's own coin
    // total happened to be), never the guest's true lifetime total.
    const passport2 = await generatePassport(request, tokenB, guestTokenB, 'The Smiths')
    expect(passport2.total_cobb_coins).toBe(21)
    expect(passport2.total_cobb_coins).not.toBe(passport1.total_cobb_coins)

    // Back on device A, more coins earned, a third passport generated --
    // must reflect genuine growth over time, not the same frozen number as
    // either passport above.
    await earnCoinsViaPuzzle(request, tokenA, guestTokenA, 2) // +6
    const passport3 = await generatePassport(request, tokenA, guestTokenA, 'The Smiths')
    expect(passport3.total_cobb_coins).toBe(27)
    expect(passport3.total_cobb_coins).not.toBe(passport2.total_cobb_coins)
    expect(passport3.total_cobb_coins).not.toBe(passport1.total_cobb_coins)
  })

  test('an anonymous passport (no guest logged in) still uses the current session\'s own total, unaffected by the guest-aware path', async ({
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    const challengeId = await getFirstPuzzleChallengeId(request)
    const res = await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
      ...withSession(token),
      data: { elapsed_seconds: 10, hints_used: 0 },
    })
    expect(res.ok()).toBe(true)

    const passportRes = await request.post(`${API}/passport/generate`, {
      ...withSession(token),
      multipart: { family_label: 'Anonymous Family' },
    })
    expect(passportRes.ok()).toBe(true)
    const body = (await passportRes.json()) as { stats: PassportStats }
    expect(body.stats.total_cobb_coins).toBe(12)
  })
})
