import { test, expect, type APIRequestContext } from '@playwright/test'
import { withSession } from './deviceSessionHelper'

// Guest Accounts Phase 2 -- Scavenger Hunt (verification-only phase, per the
// ticket). Scavenger Hunt always resets fresh every visit -- logged in or
// anonymous, no carry-forward ever -- unlike Coins/Collectibles (Phase 1,
// lifetime totals) and Bingo+Map (Phase 3, guest-chosen carry-forward). So
// this phase needed no new Hunt code: hunt_progress's own reset in
// app/services/session_reset.py has zero guest-awareness (it's deleted
// unconditionally, before the is_linked_to_guest branch even starts), and
// Hunt's coin awards (+15/character, +25 all-complete) already fold into a
// logged-in guest's lifetime total for free, via the exact same
// award_coins(session_id) / get_total(session_id, guest_id) path Phase 1
// wired up for every other coin source -- nothing Hunt-specific was added or
// needed. This file is the direct proof for both guarantees, mirroring
// guest-accounts-lifetime.spec.ts's rigor (real HTTP round trips against the
// live dev Supabase project, not inference from "the number went up").

const API = 'http://localhost:8000'

interface Challenge {
  id: string
  order_index: number
}

interface HuntCharacter {
  id: string
  name: string
  challenges: Challenge[]
  challenges_completed: number[]
  completed_at: string | null
  unlocked: boolean
  coins_awarded: number
}

const PASSWORD = 'correct horse battery staple'

function uniqueEmail(): string {
  return `guest-hunt-${crypto.randomUUID()}@example.com`
}

// Mirrors guest-accounts-lifetime.spec.ts's withGuestSession -- attaches both
// the device session token every endpoint requires and, optionally, a guest
// auth token, the same way api.ts's request() rides X-Guest-Auth along
// whenever one is stored.
function withGuestSession(deviceToken: string, guestToken?: string): { headers: Record<string, string> } {
  const headers: Record<string, string> = { 'X-Device-Session': deviceToken }
  if (guestToken) headers['X-Guest-Auth'] = guestToken
  return { headers }
}

async function resetSessionApi(
  request: APIRequestContext,
  deviceToken: string,
  guestToken?: string,
): Promise<{ hunt_characters_reset: number; coins_reset: number; guest_logged_out: boolean }> {
  const res = await request.post(`${API}/session/reset`, withGuestSession(deviceToken, guestToken))
  expect(res.ok()).toBe(true)
  return res.json()
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

async function listCharacters(request: APIRequestContext, token: string): Promise<HuntCharacter[]> {
  const res = await request.get(`${API}/hunt/characters`, withSession(token))
  return res.json()
}

async function unlockCharacter(request: APIRequestContext, characterId: string, token: string): Promise<HuntCharacter> {
  const res = await request.post(`${API}/hunt/characters/${characterId}/unlock`, withSession(token))
  return res.json()
}

async function completeChallenge(request: APIRequestContext, challengeId: string, token: string): Promise<HuntCharacter> {
  const res = await request.post(`${API}/hunt/challenges/${challengeId}/complete`, withSession(token))
  return res.json()
}

// Completes every one of a character's challenges, in order, and returns the
// response from the final (character-completing) call. Same helper as
// hunt-sessions.spec.ts.
async function completeAllChallenges(
  request: APIRequestContext,
  character: HuntCharacter,
  token: string,
): Promise<HuntCharacter> {
  let last = character
  for (const challenge of character.challenges.slice().sort((a, b) => a.order_index - b.order_index)) {
    last = await completeChallenge(request, challenge.id, token)
  }
  return last
}

test.describe('Guest Accounts Phase 2 -- Scavenger Hunt', () => {
  test('a logged-in guest\'s Hunt-earned coins (per-character +15 and the +25 all-complete bonus) automatically fold into their lifetime coin total', async ({
    request,
  }) => {
    test.setTimeout(60_000)
    const email = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)

    const characters = await listCharacters(request, tokenA)
    expect(characters).toHaveLength(5)

    // Complete the first character while logged in -- +15, with no Hunt-
    // specific guest plumbing: hunt_service.complete_challenge just calls
    // award_coins(..., session_id) exactly as it does for an anonymous
    // session (see hunt-sessions.spec.ts). Read back through the guest-scoped
    // /coins/summary (X-Guest-Auth attached) as the direct proof this single
    // award is already visible in the lifetime total, not just the
    // per-session one.
    const unlocked = await unlockCharacter(request, characters[0].id, tokenA)
    const completed = await completeAllChallenges(request, unlocked, tokenA)
    expect(completed.coins_awarded).toBe(15)
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(15)

    // A second device, logging in (not signing up) to the SAME guest, sees
    // the exact same total -- proves this isn't a per-session coincidence but
    // a genuine cross-session join (app/services/coins.py's get_total via
    // list_guest_session_ids), same as Phase 1 already proved for Puzzle
    // Timer coins.
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenB)
    const guestTokenB = await login(request, tokenB, email)
    expect(await getCoinsTotal(request, tokenB, guestTokenB)).toBe(15)

    // Finish the remaining 4 characters on device A -- the 5th completion
    // must also fire the +25 all-complete bonus, and that too must already be
    // visible in the lifetime total with no new code.
    let last: HuntCharacter | undefined
    for (const character of characters.slice(1)) {
      const unlockedNext = await unlockCharacter(request, character.id, tokenA)
      last = await completeAllChallenges(request, unlockedNext, tokenA)
    }
    expect(last!.coins_awarded).toBe(15 + 25) // 5th character's own +15, plus the one-time +25 bonus

    const expectedTotal = 15 * 5 + 25
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(expectedTotal)
    // Device B's lifetime view reflects the bonus too, despite never itself
    // touching Hunt.
    expect(await getCoinsTotal(request, tokenB, guestTokenB)).toBe(expectedTotal)
  })

  test('Reset Session clears hunt_progress identically for a logged-in guest and an anonymous session -- unlike Coins, Hunt has no guest-awareness branch', async ({
    request,
  }) => {
    const email = uniqueEmail()

    // Logged-in guest: unlock + fully complete one character (earns +15),
    // then Reset Session.
    const tokenGuest = crypto.randomUUID()
    await resetSessionApi(request, tokenGuest)
    const guestToken = await signup(request, tokenGuest, email)
    const guestCharacters = await listCharacters(request, tokenGuest)
    const unlockedGuest = await unlockCharacter(request, guestCharacters[0].id, tokenGuest)
    await completeAllChallenges(request, unlockedGuest, tokenGuest)
    expect(await getCoinsTotal(request, tokenGuest, guestToken)).toBe(15)

    const resetGuest = await resetSessionApi(request, tokenGuest, guestToken)
    expect(resetGuest.guest_logged_out).toBe(true)
    // Coins/Collectibles' Phase 1 guest-aware branch skips deletion for a
    // linked session -- that's the contrast case.
    expect(resetGuest.coins_reset).toBe(0)
    // hunt_progress has no equivalent branch: the one row this session
    // created (for the one character it touched) is deleted exactly as it
    // would be for an anonymous session.
    expect(resetGuest.hunt_characters_reset).toBe(1)

    // Anonymous session: identical actions (unlock + fully complete one
    // character, earning +15), then Reset Session with no guest header.
    const tokenAnon = crypto.randomUUID()
    await resetSessionApi(request, tokenAnon)
    const anonCharacters = await listCharacters(request, tokenAnon)
    const unlockedAnon = await unlockCharacter(request, anonCharacters[0].id, tokenAnon)
    await completeAllChallenges(request, unlockedAnon, tokenAnon)
    expect(await getCoinsTotal(request, tokenAnon)).toBe(15)

    const resetAnon = await resetSessionApi(request, tokenAnon)
    expect(resetAnon.guest_logged_out).toBe(false)
    // Anonymous Reset Session DOES delete its own coin_awards row -- the
    // contrast that isolates hunt_characters_reset as the apples-to-apples
    // comparison below.
    expect(resetAnon.coins_reset).toBe(1)
    // The same hunt_characters_reset count as the logged-in guest above,
    // despite coins_reset differing -- direct proof hunt_progress's own
    // reset genuinely carries zero guest-awareness logic.
    expect(resetAnon.hunt_characters_reset).toBe(resetGuest.hunt_characters_reset)

    // Both sessions' own Hunt view is back to fully locked/uncompleted after
    // their respective resets.
    const guestCharactersAfter = await listCharacters(request, tokenGuest)
    expect(guestCharactersAfter.every((c) => !c.unlocked && c.challenges_completed.length === 0)).toBe(true)
    const anonCharactersAfter = await listCharacters(request, tokenAnon)
    expect(anonCharactersAfter.every((c) => !c.unlocked && c.challenges_completed.length === 0)).toBe(true)
  })

  test('after Reset Session logs a guest out, completing a Hunt character on the next (freshly-rotated, anonymous) session does not attribute coins to the previous guest', async ({
    request,
  }) => {
    // Models the kiosk handoff, same scenario as guest-accounts-lifetime.spec.ts's
    // equivalent test, but for Hunt-earned coins specifically -- confirming
    // Hunt introduces no attribution path of its own that could leak across
    // the device handoff (it can't: hunt.py's complete_challenge never reads
    // or writes guest_id, only session_id).
    const email = uniqueEmail()

    const tokenA = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    const guestTokenA = await signup(request, tokenA, email)
    const charactersA = await listCharacters(request, tokenA)
    const unlockedA = await unlockCharacter(request, charactersA[0].id, tokenA)
    await completeAllChallenges(request, unlockedA, tokenA) // +15
    expect(await getCoinsTotal(request, tokenA, guestTokenA)).toBe(15)

    const resetResult = await resetSessionApi(request, tokenA, guestTokenA)
    expect(resetResult.guest_logged_out).toBe(true)

    // The next physical person on this device: a brand new token, no
    // X-Guest-Auth at all -- exactly what deviceSession.ts's
    // rotateDeviceSessionId produces.
    const tokenNext = crypto.randomUUID()
    const charactersNext = await listCharacters(request, tokenNext)
    const unlockedNext = await unlockCharacter(request, charactersNext[0].id, tokenNext)
    await completeAllChallenges(request, unlockedNext, tokenNext) // +15, purely anonymous

    // Their own session-scoped total sees only their own 15.
    expect(await getCoinsTotal(request, tokenNext)).toBe(15)

    // Adversarial case: even if guest A's now-invalidated token rode along,
    // get_optional_guest treats it as anonymous, so this must still read as
    // session-scoped (15), not guest A's lifetime.
    expect(await getCoinsTotal(request, tokenNext, guestTokenA)).toBe(15)

    // Decisive check: guest A's lifetime total, read via an entirely
    // independent later login, is exactly the 15 they actually earned --
    // NOT 30. The only way this could read 30 is if tokenNext's session had
    // somehow been linked to guest A, which nothing here ever did.
    const tokenC = crypto.randomUUID()
    const guestTokenA2 = await login(request, tokenC, email)
    expect(await getCoinsTotal(request, tokenC, guestTokenA2)).toBe(15)
  })
})
