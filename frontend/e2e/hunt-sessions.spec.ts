import { test, expect, type APIRequestContext } from '@playwright/test'
import { withSession } from './deviceSessionHelper'

// Per-Device Sessions Phase 6b (migration 030, FINAL phase of the Per-Device
// Sessions migration): hunt_progress moved from one global row per character
// to one row per (session, character) pair -- each family's own found/
// unlocked and challenge-completion progress on the shared hunt_characters/
// hunt_challenges content. Character definitions/theming/challenge content
// themselves are untouched, same "shared content, per-session progress"
// split as Bingo (migration 029) and Map (migration 026).
//
// This file covers what's new: two sessions unlocking/completing characters
// on the same shared roster end up with completely independent found/
// completed status and coin attribution (both the per-character 15-coin
// award and the +25 all-5-complete bonus -- including a regression check for
// a real bug the migration could have introduced: the old all-complete guard
// checked `all(completed_at is not null)` over what used to always be
// exactly 5 pre-seeded rows, which silently stops being a valid "all 5 done"
// check once rows are created lazily per session and a session might have
// only 1 or 2 of them), and a fresh device session arriving via a raw
// QR-style deep link (not through normal in-app navigation) correctly
// establishes its own session and its own independent progress.
//
// Raw HTTP throughout for the isolation/bonus tests (no `page`) -- same
// reasoning as bingo-sessions.spec.ts: nothing there needs the UI. The
// deep-link test does drive `page`, since establishing a device session on
// first paint is specifically a frontend behavior (frontend/src/
// deviceSession.ts) that raw request.*() calls can't exercise.

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

async function resetSessionApi(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.post(`${API}/session/reset`, withSession(token))
  expect(res.ok()).toBe(true)
}

async function listCharacters(request: APIRequestContext, token: string): Promise<HuntCharacter[]> {
  const res = await request.get(`${API}/hunt/characters`, withSession(token))
  return res.json()
}

async function unlockCharacter(
  request: APIRequestContext,
  characterId: string,
  token: string,
): Promise<HuntCharacter> {
  const res = await request.post(`${API}/hunt/characters/${characterId}/unlock`, withSession(token))
  return res.json()
}

async function completeChallenge(
  request: APIRequestContext,
  challengeId: string,
  token: string,
): Promise<HuntCharacter> {
  const res = await request.post(`${API}/hunt/challenges/${challengeId}/complete`, withSession(token))
  return res.json()
}

async function getCoinsTotal(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withSession(token))
  const body = (await res.json()) as { total: number }
  return body.total
}

// Completes every one of a character's challenges, in order, and returns the
// response from the final (character-completing) call.
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

test.describe('Scavenger Hunt progress, per device session', () => {
  test('two sessions unlocking/completing the same shared character roster have independent found/completed status and per-character coin attribution', async ({
    request,
  }) => {
    // ~15 sequential real HTTP round trips against the live dev Supabase
    // project -- same "more than the default 30s budget" reasoning as
    // cobb-coins.spec.ts's 25-tile-completion test.
    test.setTimeout(45_000)
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)

    const charactersA = await listCharacters(request, tokenA)
    expect(charactersA).toHaveLength(5)
    expect(charactersA.every((c) => !c.unlocked)).toBe(true)

    // Session B has touched nothing -- same shared roster, still fully locked.
    const charactersB = await listCharacters(request, tokenB)
    expect(charactersB.every((c) => !c.unlocked)).toBe(true)

    const target = charactersA[0]

    const unlockedA = await unlockCharacter(request, target.id, tokenA)
    expect(unlockedA.unlocked).toBe(true)
    expect(unlockedA.challenges_completed).toEqual([])

    // B's view of the exact same character is untouched by A's unlock.
    const stillLockedForB = (await listCharacters(request, tokenB)).find((c) => c.id === target.id)!
    expect(stillLockedForB.unlocked).toBe(false)

    const completedA = await completeAllChallenges(request, unlockedA, tokenA)
    expect(completedA.challenges_completed.slice().sort()).toEqual([1, 2, 3])
    expect(completedA.completed_at).not.toBeNull()
    expect(completedA.coins_awarded).toBe(15)

    // B unlocks and completes the SAME physical character independently --
    // also pays the per-character award, not blocked by A having already
    // completed it (the (session_id, character_id) unique constraint means
    // each session holds its own row for it).
    const unlockedB = await unlockCharacter(request, target.id, tokenB)
    expect(unlockedB.challenges_completed).toEqual([])
    const completedB = await completeAllChallenges(request, unlockedB, tokenB)
    expect(completedB.coins_awarded).toBe(15)

    expect(await getCoinsTotal(request, tokenA)).toBe(15)
    expect(await getCoinsTotal(request, tokenB)).toBe(15)

    // A's unlock/completion of the target character doesn't leak onto B's
    // status for any of the OTHER characters.
    const otherForB = (await listCharacters(request, tokenB)).find((c) => c.id !== target.id)!
    expect(otherForB.unlocked).toBe(false)
  })

  test('the +25 all-5-characters-complete bonus fires exactly once per session, only once that session has genuinely completed all 5 (not just "every row it happens to have")', async ({
    request,
  }) => {
    // ~25 sequential real HTTP round trips against the live dev Supabase
    // project (5 characters x unlock + 3 challenges each, across two
    // sessions) -- same "more than the default 30s budget" reasoning as
    // cobb-coins.spec.ts's 25-tile-completion test.
    test.setTimeout(60_000)
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)

    const characters = await listCharacters(request, tokenA)
    expect(characters).toHaveLength(5)

    // Session A completes only 4 of the 5 characters -- must NOT trigger the
    // all-complete bonus yet. This is the key regression check: every
    // hunt_progress row session A has created so far IS fully completed, so
    // a guard that only checked `all(completed_at is not null)` without also
    // checking the row count against the total would incorrectly fire here.
    let lastA: HuntCharacter | undefined
    for (const character of characters.slice(0, 4)) {
      const unlocked = await unlockCharacter(request, character.id, tokenA)
      lastA = await completeAllChallenges(request, unlocked, tokenA)
    }
    expect(lastA!.coins_awarded).toBe(15) // per-character only -- no +25 yet
    expect(await getCoinsTotal(request, tokenA)).toBe(60) // 4 * 15

    // Session B, meanwhile, completes just ONE character -- it must not see
    // any bonus either, and A's near-complete progress must not leak into
    // B's own guard (each session's "all complete" check is scoped to its
    // own session_id).
    const unlockedB = await unlockCharacter(request, characters[0].id, tokenB)
    const completedB = await completeAllChallenges(request, unlockedB, tokenB)
    expect(completedB.coins_awarded).toBe(15)
    expect(await getCoinsTotal(request, tokenB)).toBe(15)

    // Session A now completes its 5th and final character -- this is the one
    // call that should trigger both the per-character AND the +25
    // all-complete bonus in the same response.
    const fifth = characters[4]
    const unlockedFifth = await unlockCharacter(request, fifth.id, tokenA)
    const completedFifth = await completeAllChallenges(request, unlockedFifth, tokenA)
    expect(completedFifth.coins_awarded).toBe(15 + 25)
    expect(await getCoinsTotal(request, tokenA)).toBe(60 + 15 + 25)

    // B is still nowhere near complete -- completely untouched by A's bonus.
    expect(await getCoinsTotal(request, tokenB)).toBe(15)

    // Re-completing challenge 1 of an already-fully-complete character
    // (idempotent no-op, same as a guest re-scanning it) must not re-fire
    // either award for A.
    const reCompleted = await completeChallenge(request, fifth.challenges[0].id, tokenA)
    expect(reCompleted.coins_awarded).toBe(0)
    expect(await getCoinsTotal(request, tokenA)).toBe(60 + 15 + 25)
  })

  test('a fresh device session arriving via a raw QR-style deep link (no prior in-app navigation) establishes its own session and unlocks independently of any other session', async ({
    page,
    request,
  }) => {
    // Simulates a guest's own camera app opening a printed sign's URL fresh
    // -- no seedDeviceSession, no prior page.goto('/'), nothing in
    // localStorage yet. frontend/src/deviceSession.ts's getDeviceSessionId()
    // mints a brand-new token into localStorage the moment the app's first
    // API call fires (ScanScreen.tsx's api.resolveScanCode, wired through
    // api.ts's request() helper, which attaches X-Device-Session
    // unconditionally on every call) -- this confirms that path actually
    // works end to end for Hunt specifically, not just the normal
    // in-app-navigation path every other Hunt e2e test already covers.
    const otherToken = crypto.randomUUID()
    await resetSessionApi(request, otherToken)

    await page.goto('/scan/sleepy-koala') // Sloth's code

    const startButton = page.getByRole('button', { name: 'Start Challenges' })
    await expect(startButton).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sloth' })).toBeVisible()
    await startButton.click()
    await expect(page.getByText('Sloth — Challenge 1')).toBeVisible()

    // Pull the token this fresh page actually minted for itself, so the
    // assertions below can query the backend directly under it.
    const mintedToken = await page.evaluate(() => localStorage.getItem('cap-device-session-id'))
    expect(mintedToken).toBeTruthy()

    const characters = await listCharacters(request, mintedToken!)
    const sloth = characters.find((c) => c.name === 'Sloth')!
    expect(sloth.unlocked).toBe(true)

    // A completely independent session (never touched Sloth) still sees it
    // fully locked -- the deep-link session's unlock didn't leak globally,
    // and this session was genuinely established on its own, not
    // accidentally sharing state with `otherToken`.
    const charactersOther = await listCharacters(request, otherToken)
    expect(charactersOther.find((c) => c.name === 'Sloth')!.unlocked).toBe(false)
  })
})
