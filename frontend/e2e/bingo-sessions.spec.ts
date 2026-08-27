import { test, expect, type APIRequestContext } from '@playwright/test'
import { withSession } from './deviceSessionHelper'

// Per-Device Sessions Phase 6a (migration 029): Bingo tile completion and
// milestone-achievement status moved from global bingo_tiles.completed /
// bingo_cards.milestone_lines/milestone_x/milestone_blackout columns into
// session_tile_completions, one row per (session, tile) pair -- the
// milestone flags themselves are no longer stored at all, computed live per
// session by app/services/milestone.py's achieved_milestones(). The Bingo
// tile *layout* (which activity sits in which grid position) stays exactly
// as-is: one single shared card every family sees.
//
// This file covers what's new: two sessions completing tiles on the same
// shared layout end up with completely independent completion/milestone
// progress and bonus-minigame triggers, and the milestone tie-break logic
// (still app/services/milestone.py's detect_new_milestones/
// select_display_milestone, unchanged) resolves correctly when re-verified
// per session rather than trusted to "still work" from cobb-coins.spec.ts's
// single-session coverage.
//
// Raw HTTP throughout (no `page`) -- same reasoning as
// map-visited-sessions.spec.ts: nothing here needs the UI, and driving 5+
// tile completions per session through BingoScreen's click-through would be
// slow for no benefit.

const API = 'http://localhost:8000'

interface CardResponse {
  tiles: { id: string; completed: boolean }[]
  milestones_achieved: { lines: number[]; x: boolean; blackout: boolean }
}

async function getCardId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/bingo/cards`)
  const cards = (await res.json()) as { id: string }[]
  return cards[0].id
}

async function getCard(request: APIRequestContext, cardId: string, token: string): Promise<CardResponse> {
  const res = await request.get(`${API}/bingo/card/${cardId}`, withSession(token))
  return res.json()
}

async function getTileIds(request: APIRequestContext, cardId: string, token: string): Promise<string[]> {
  const card = await getCard(request, cardId, token)
  return card.tiles.map((t) => t.id)
}

async function completeTile(request: APIRequestContext, tileId: string, token: string): Promise<any> {
  const res = await request.post(`${API}/bingo/tiles/${tileId}/complete`, withSession(token))
  return res.json()
}

async function resetSessionApi(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.post(`${API}/session/reset`, withSession(token))
  expect(res.ok()).toBe(true)
}

async function getCoinsTotal(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${API}/coins/summary`, withSession(token))
  const body = (await res.json()) as { total: number }
  return body.total
}

test.describe('Bingo completion, per device session', () => {
  test('two sessions completing tiles on the same shared card have independent completion, milestone, and bonus-minigame state', async ({
    request,
  }) => {
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)

    const cardId = await getCardId(request)
    // Same tile-id list regardless of which session's token fetches it --
    // the layout itself is shared; row 0 is grid indices 0-4.
    const tileIds = await getTileIds(request, cardId, tokenA)

    // Session A completes 4 of row 0's 5 tiles -- one short of a line.
    for (let i = 0; i < 4; i++) {
      const result = await completeTile(request, tileIds[i], tokenA)
      expect(result.milestones).toHaveLength(0)
      expect(result.minigames_drawn).toHaveLength(1) // base draw only, no milestone bonus draw
    }

    const cardAfterA = await getCard(request, cardId, tokenA)
    expect(cardAfterA.tiles.slice(0, 4).every((t) => t.completed)).toBe(true)
    expect(cardAfterA.tiles[4].completed).toBe(false)

    // Session B has touched nothing -- its own view of the exact same card
    // shows every tile still open, completely unaffected by A's 4 completions.
    const cardB_beforeB = await getCard(request, cardId, tokenB)
    expect(cardB_beforeB.tiles.every((t) => !t.completed)).toBe(true)
    expect(cardB_beforeB.milestones_achieved).toEqual({ lines: [], x: false, blackout: false })

    // Session B now completes ONLY tile 4 (row 0's last tile) -- for B this
    // is 1 of 5 in that row, not a line: no milestone, single base draw.
    // This is the key bonus-minigame-trigger isolation check -- the exact
    // same tile_id that would complete session A's row 0 does nothing
    // milestone-wise for B, because it's computed from B's own completed
    // set only.
    const bResult = await completeTile(request, tileIds[4], tokenB)
    expect(bResult.milestones).toHaveLength(0)
    expect(bResult.minigames_drawn).toHaveLength(1)
    expect(bResult.coins_awarded).toBe(0)

    // Session A's view of tile 4 is untouched by B's completion of that same
    // physical tile -- the (session_id, tile_id) unique constraint means two
    // sessions can each independently hold their own completion row for it.
    const cardAfterB = await getCard(request, cardId, tokenA)
    expect(cardAfterB.tiles[4].completed).toBe(false)

    // Session A now completes tile 4 itself, closing its own row 0 -- the
    // milestone fires off A's own accumulated tiles (0-3 from above, most
    // completed long before B ever touched tile 4), with a 2nd bonus
    // minigame draw for the milestone celebration per app/services/
    // minigame_draw.py's draw_for_tile_completion.
    const aResult = await completeTile(request, tileIds[4], tokenA)
    expect(aResult.milestones).toHaveLength(1)
    expect(aResult.milestones[0].type).toBe('line')
    expect(aResult.coins_awarded).toBe(10)
    expect(aResult.minigames_drawn).toHaveLength(2) // base draw + milestone bonus draw

    const cardFinalA = await getCard(request, cardId, tokenA)
    expect(cardFinalA.milestones_achieved).toEqual({ lines: [0], x: false, blackout: false })

    // Session B's milestone state is still completely untouched by A's line
    // completion -- B only ever completed 1 tile of its own.
    const cardFinalB = await getCard(request, cardId, tokenB)
    expect(cardFinalB.tiles[4].completed).toBe(true) // B's own earlier completion
    expect(cardFinalB.tiles.slice(0, 4).every((t) => !t.completed)).toBe(true)
    expect(cardFinalB.milestones_achieved).toEqual({ lines: [], x: false, blackout: false })

    expect(await getCoinsTotal(request, tokenA)).toBe(10)
    expect(await getCoinsTotal(request, tokenB)).toBe(0)
  })

  test('the X-shape tie-break (single completion pays only the highest tier) resolves independently for two sessions racing the same shared card', async ({
    request,
  }) => {
    const tokenA = crypto.randomUUID()
    const tokenB = crypto.randomUUID()
    await resetSessionApi(request, tokenA)
    await resetSessionApi(request, tokenB)

    const cardId = await getCardId(request)
    const tileIds = await getTileIds(request, cardId, tokenA)
    const X_SHAPE = [0, 4, 6, 8, 12, 16, 18, 20, 24]

    // Interleaved, not sequential: each X-shape tile is completed for A and
    // then immediately for B, so both sessions' own bookkeeping is built up
    // concurrently on the same physical tiles -- a stronger isolation check
    // than running each session's full sequence back to back.
    let lastA: any
    let lastB: any
    for (const i of X_SHAPE) {
      lastA = await completeTile(request, tileIds[i], tokenA)
      lastB = await completeTile(request, tileIds[i], tokenB)
    }

    // Both sessions independently close the X shape on their own final tile
    // -- neither's tie-break result was thrown off by the other racing the
    // same tile ids underneath it.
    expect(lastA.milestones).toHaveLength(1)
    expect(lastA.milestones[0].type).toBe('x')
    expect(lastA.coins_awarded).toBe(25)

    expect(lastB.milestones).toHaveLength(1)
    expect(lastB.milestones[0].type).toBe('x')
    expect(lastB.coins_awarded).toBe(25)

    expect(await getCoinsTotal(request, tokenA)).toBe(25)
    expect(await getCoinsTotal(request, tokenB)).toBe(25)

    const cardA = await getCard(request, cardId, tokenA)
    const cardB = await getCard(request, cardId, tokenB)
    expect(cardA.milestones_achieved).toEqual({ lines: [], x: true, blackout: false })
    expect(cardB.milestones_achieved).toEqual({ lines: [], x: true, blackout: false })
  })
})
