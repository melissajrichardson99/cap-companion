import { test, expect, type APIRequestContext } from '@playwright/test'
import { seedDeviceSession, withSession } from './deviceSessionHelper'

// Guest Accounts Phase 4 -- Family Passport history
// (migration 038_passport_guest_history.sql). Complements
// frontend/e2e/family-passport.spec.ts (anonymous generation, stats
// correctness -- deliberately untouched by this phase) and
// guest-accounts-lifetime.spec.ts (the Coins/Collectibles cross-session-join
// pattern this phase deliberately does NOT need -- a passport is tagged with
// guest_id once at creation and never re-derived).

const API = 'http://localhost:8000'

function uniqueEmail(): string {
  return `guest-passport-${crypto.randomUUID()}@example.com`
}

const PASSWORD = 'correct horse battery staple'

interface PassportSession {
  id: string
  family_label: string
  generated_at: string
}

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

async function generatePassport(
  request: APIRequestContext,
  deviceToken: string,
  familyLabel: string,
  guestToken?: string,
): Promise<PassportSession> {
  const res = await request.post(`${API}/passport/generate`, {
    ...withGuestSession(deviceToken, guestToken),
    multipart: { family_label: familyLabel },
  })
  expect(res.ok()).toBe(true)
  return res.json()
}

async function getPassportHistory(request: APIRequestContext, guestToken: string): Promise<PassportSession[]> {
  const res = await request.get(`${API}/account/passports`, { headers: { 'X-Guest-Auth': guestToken } })
  expect(res.ok()).toBe(true)
  return res.json()
}

test.describe('Guest Accounts Phase 4 -- Family Passport history', () => {
  test('a passport generated while logged in appears in that guest\'s history, ordered newest first', async ({
    request,
  }) => {
    const email = uniqueEmail()
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    const guestToken = await signup(request, token, email)

    const first = await generatePassport(request, token, `History First ${Date.now()}`, guestToken)
    const second = await generatePassport(request, token, `History Second ${Date.now()}`, guestToken)

    const history = await getPassportHistory(request, guestToken)
    const ids = history.map((p) => p.id)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
    // Newest first.
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
  })

  test('a passport generated before login is retroactively linked and appears in history after logging in mid-visit', async ({
    request,
  }) => {
    const email = uniqueEmail()
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)

    // Generated anonymously -- no guest header at all yet.
    const beforeLogin = await generatePassport(request, token, `Pre-Login Family ${Date.now()}`)

    // Logging in on the SAME device session, mid-visit, should retroactively
    // backfill guest_id onto the passport generated just above.
    const guestToken = await signup(request, token, email)

    const history = await getPassportHistory(request, guestToken)
    expect(history.map((p) => p.id)).toContain(beforeLogin.id)
  })

  test('two different guests never see each other\'s passport history', async ({ request }) => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, emailA)
    const passportA = await generatePassport(request, tokenA, `Isolation Family A ${Date.now()}`, guestTokenA)

    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenB)
    const guestTokenB = await signup(request, tokenB, emailB)
    const passportB = await generatePassport(request, tokenB, `Isolation Family B ${Date.now()}`, guestTokenB)

    const historyA = await getPassportHistory(request, guestTokenA)
    const historyB = await getPassportHistory(request, guestTokenB)

    expect(historyA.map((p) => p.id)).toContain(passportA.id)
    expect(historyA.map((p) => p.id)).not.toContain(passportB.id)
    expect(historyB.map((p) => p.id)).toContain(passportB.id)
    expect(historyB.map((p) => p.id)).not.toContain(passportA.id)
  })

  test('anonymous passport generation is unaffected, and GET /account/passports requires a logged-in guest', async ({
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)

    // No X-Guest-Auth at all -- generation works exactly as before this phase.
    const session = await generatePassport(request, token, `Anonymous Family ${Date.now()}`)
    expect(session.id).toBeTruthy()

    // No history view available for an anonymous session -- nothing to link
    // it to (get_current_guest, unlike get_optional_guest, requires the
    // header). A completely missing header fails FastAPI's own required-
    // Header validation (422) before get_current_guest ever runs; an
    // invalid/garbage one reaches get_current_guest and is rejected there
    // (401) -- same split as every other get_current_guest-gated endpoint
    // (see guest-accounts-lifetime.spec.ts's whoami checks).
    const noHeaderRes = await request.get(`${API}/account/passports`)
    expect(noHeaderRes.status()).toBe(422)
    const invalidTokenRes = await request.get(`${API}/account/passports`, {
      headers: { 'X-Guest-Auth': 'not-a-real-token' },
    })
    expect(invalidTokenRes.status()).toBe(401)
  })

  test('Passport History is reachable from the account area and shows a past passport\'s detail', async ({
    page,
  }) => {
    const email = uniqueEmail()
    const token = crypto.randomUUID()
    await seedDeviceSession(page, token)
    await page.goto('/')

    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: 'Save Your Progress' }).click()
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()

    const familyLabel = `UI History Family ${Date.now()}`
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: 'Generate Passport' }).click()
    const passportDialog = page.getByRole('dialog')
    await passportDialog.locator('.passport-family-label-input').fill(familyLabel)
    await passportDialog.getByRole('button', { name: 'Generate Passport' }).click()
    await passportDialog.getByRole('button', { name: 'Maybe later' }).click()
    await expect(passportDialog.locator('.passport-card-title')).toBeVisible()
    await passportDialog.getByRole('button', { name: 'Close' }).click()

    // The nav's account entry now shows the guest's email, not "Save Your
    // Progress" -- see guest-accounts.spec.ts's identical post-signup check.
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: email }).click()
    await expect(page.getByRole('heading', { name: 'Your Account' })).toBeVisible()
    await page.getByRole('button', { name: 'Passport History' }).click()

    const historyDialog = page.getByRole('dialog')
    const listItem = historyDialog.getByRole('button', { name: new RegExp(familyLabel) })
    await expect(listItem).toBeVisible()
    await listItem.click()

    await expect(historyDialog.locator('.passport-card-family-label')).toHaveText(familyLabel)

    await historyDialog.getByRole('button', { name: 'Back to List' }).click()
    await expect(listItem).toBeVisible()
  })
})
