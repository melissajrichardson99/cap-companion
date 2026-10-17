import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { seedDeviceSession, withSession } from './deviceSessionHelper'
import { openNavMenu } from './navMenuHelper'

// Covers the Cobb Coins spend side (migration 022_collectible_cards.sql):
// purchasing a Collectible Card deducts coins and adds it to the gallery,
// insufficient coins blocks the purchase, repeat purchases of the same
// animal each get their own independent guest_name, Reset Session clears
// the gallery, and the card artwork uses the real app logo with no arrow
// element (the two explicit deviations from the reference mockup).
//
// Per-Device Sessions Phase 1: Collectibles are now scoped to a device
// session (X-Device-Session header), same as Cobb Coins -- see
// cobb-coins.spec.ts's header comment for the full seedDeviceSession/
// withSession pattern this file reuses. Every test mints its own random
// token, seeds it into `page` before first navigation, and threads it
// through every raw API helper so the UI and the raw setup calls stay
// looking at the same session's ledger/gallery.

const API = 'http://localhost:8000'

async function expectCoinTotal(page: Page, total: number): Promise<void> {
  await openNavMenu(page)
  await expect(page.locator('.nav-menu-coins')).toHaveText(`🪙 ${total} Cobb Coins`)
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

async function getBingoCardId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/bingo/cards`)
  const cards = (await res.json()) as { id: string }[]
  return cards[0].id
}

async function getBingoTileIds(request: APIRequestContext, cardId: string, token: string): Promise<string[]> {
  const res = await request.get(`${API}/bingo/card/${cardId}`, withSession(token))
  const card = (await res.json()) as { tiles: { id: string }[] }
  return card.tiles.map((t) => t.id)
}

// Enough for a single standard-tier (100) purchase, via one earn-side
// endpoint only -- completing the whole bingo card (130, see
// cobb-coins.spec.ts) over raw HTTP. Kept deliberately cheap (25 sequential
// calls) for the tests below that also drive real UI afterward and need to
// fit inside Playwright's global per-test timeout.
async function earnEnoughForOnePurchase(request: APIRequestContext, token: string): Promise<void> {
  const cardId = await getBingoCardId(request)
  const tileIds = await getBingoTileIds(request, cardId, token)
  for (const tileId of tileIds) {
    await request.post(`${API}/bingo/tiles/${tileId}/complete`, withSession(token))
  }
}

// Enough for two standard-tier (100 each) purchases -- the bingo card (130)
// plus the 4 Scavenger Hunt characters that don't require a QR-unlock scan
// first (60) clears 190 on its own; one Puzzle Timer attempt (+12 at 0
// hints) pushes it past 200.
async function earnPlentyOfCoins(request: APIRequestContext, token: string): Promise<void> {
  await earnEnoughForOnePurchase(request, token)

  // Per-Device Sessions Phase 6b: GET /hunt/characters now requires a
  // device session header too, like every other Hunt endpoint.
  const charactersRes = await request.get(`${API}/hunt/characters`, withSession(token))
  const characters = (await charactersRes.json()) as { id: string; name: string; challenges: { id: string }[] }[]
  for (const character of characters.filter((c) => c.name !== 'Pig')) {
    for (const challenge of character.challenges) {
      await request.post(`${API}/hunt/challenges/${challenge.id}/complete`, withSession(token))
    }
  }

  const puzzlesRes = await request.get(`${API}/puzzles`)
  const puzzles = (await puzzlesRes.json()) as { challenges: { id: string }[] }[]
  const challengeId = puzzles[0].challenges[0].id
  await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
    ...withSession(token),
    data: { elapsed_seconds: 10, hints_used: 0 },
  })
}

interface CollectibleCardRow {
  id: string
  animal_slug: string
  tier: string
  photo_index: number
  guest_name: string
  coins_spent: number
}

async function purchase(
  request: APIRequestContext,
  animalSlug: string,
  guestName: string,
  token: string,
): Promise<{ status: number; body: CollectibleCardRow | { detail: string } }> {
  const res = await request.post(`${API}/collectibles/purchase`, {
    ...withSession(token),
    data: { animal_slug: animalSlug, guest_name: guestName },
  })
  return { status: res.status(), body: await res.json() }
}

async function listCollectibles(request: APIRequestContext, token: string): Promise<CollectibleCardRow[]> {
  const res = await request.get(`${API}/collectibles`, withSession(token))
  return res.json()
}

test.describe('Collectible Cards', () => {
  test('purchasing a card deducts coins and adds it to the gallery', async ({ page, request }) => {
    // Needs coins for two purchases (one via raw API below, one via the UI
    // walkthrough further down) -- earnPlentyOfCoins, not the cheaper
    // single-purchase helper. Setup plus a full UI purchase walkthrough is
    // also more than the default per-test budget covers on a cold
    // dev-server compile.
    test.setTimeout(60_000)
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    await earnPlentyOfCoins(request, token)
    const totalBefore = await getCoinsTotal(request, token)

    const { status, body } = await purchase(request, 'capybara', 'Jordan', token)
    expect(status).toBe(200)
    const card = body as CollectibleCardRow
    expect(card.animal_slug).toBe('capybara')
    expect(card.guest_name).toBe('Jordan')
    expect(card.coins_spent).toBe(100)

    expect(await getCoinsTotal(request, token)).toBe(totalBefore - 100)
    const cards = await listCollectibles(request, token)
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe(card.id)

    // Drive the same purchase through the real UI at least once, so the
    // shop/reveal/gallery are proven to actually render, not just the API.
    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Collectibles' }).click()
    const shopCard = page.locator('.collectible-shop-card', { hasText: 'Kangaroo' })
    await shopCard.getByRole('button', { name: 'Collect' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/collecting this one/i).fill('Alex')
    await dialog.getByRole('button', { name: 'Collect', exact: true }).click()
    await expect(dialog.getByText('You collected a new card!')).toBeVisible()
    await expect(dialog.locator('.collectible-card-collected-name')).toHaveText('Alex')
    await dialog.getByRole('button', { name: 'Done' }).click()

    await page.getByRole('tab', { name: 'Your Collection (2)' }).click()
    await expect(page.locator('.collectible-gallery-item')).toHaveCount(2)
  })

  test('insufficient coins blocks the purchase with a clear message and does not change the total', async ({
    page,
    request,
  }) => {
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    expect(await getCoinsTotal(request, token)).toBe(0)

    const { status, body } = await purchase(request, 'capybara', 'Nobody', token)
    expect(status).toBe(409)
    expect((body as { detail: string }).detail).toMatch(/not enough/i)
    expect(await getCoinsTotal(request, token)).toBe(0)
    expect(await listCollectibles(request, token)).toHaveLength(0)

    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Collectibles' }).click()
    const shopCard = page.locator('.collectible-shop-card', { hasText: 'Capybara' })
    await expect(shopCard.getByRole('button', { name: 'Collect' })).toBeDisabled()
    await expect(shopCard.getByText('Not enough coins yet')).toBeVisible()
  })

  test('buying the same animal twice each rolls its own guest_name, independent of the other purchase', async ({
    request,
  }) => {
    // earnPlentyOfCoins alone is ~45 sequential setup requests against the
    // real dev Supabase project -- each Bingo tile completion in particular
    // is several round trips now (session_tile_completions read/write,
    // Per-Device Sessions Phase 6a), so this needs more headroom than the
    // default per-test budget (confirmed consistently exceeding 45s here).
    test.setTimeout(75_000)
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await earnPlentyOfCoins(request, token)

    const first = await purchase(request, 'sloth', 'Jordan', token)
    expect(first.status).toBe(200)
    const second = await purchase(request, 'sloth', 'Alex', token)
    expect(second.status).toBe(200)

    const cards = await listCollectibles(request, token)
    const slothCards = cards.filter((c) => c.animal_slug === 'sloth')
    expect(slothCards).toHaveLength(2)
    const names = slothCards.map((c) => c.guest_name).sort()
    expect(names).toEqual(['Alex', 'Jordan'])
  })

  test('Reset Session clears the gallery and does not restore prior collectibles', async ({ page, request }) => {
    test.setTimeout(60_000)
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    await earnEnoughForOnePurchase(request, token)
    await purchase(request, 'capybara', 'Jordan', token)
    expect(await listCollectibles(request, token)).toHaveLength(1)

    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('button', { name: 'Reset Session' }).click()
    const resetConfirmDialog = page.getByRole('dialog', { name: 'Reset Session' })
    await resetConfirmDialog.getByRole('button', { name: 'Reset Session' }).click()
    await expect(resetConfirmDialog).toHaveCount(0)
    // expectCoinTotal opens the nav menu itself and leaves it open (same as
    // cobb-coins.spec.ts's equivalent test) -- it's already open here, so
    // selecting the next tab below must not try to open it again.
    await expectCoinTotal(page, 0)

    expect(await listCollectibles(request, token)).toHaveLength(0)

    await page.getByRole('menuitemradio', { name: 'Collectibles' }).click()
    await page.getByRole('tab', { name: /Your Collection \(0\)/ }).click()
    await expect(page.getByText("You haven't collected any cards yet")).toBeVisible()
  })

  test('the card uses the real app logo and has no arrow element in the bottom banner', async ({ page, request }) => {
    test.setTimeout(60_000)
    const token = crypto.randomUUID()
    await resetSessionApi(request, token)
    await seedDeviceSession(page, token)
    await earnEnoughForOnePurchase(request, token)

    await page.goto('/')
    await openNavMenu(page)
    await page.getByRole('menuitemradio', { name: 'Collectibles' }).click()
    const shopCard = page.locator('.collectible-shop-card', { hasText: 'Emu' })
    await shopCard.getByRole('button', { name: 'Collect' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/collecting this one/i).fill('River')
    await dialog.getByRole('button', { name: 'Collect', exact: true }).click()
    await expect(dialog.getByText('You collected a new card!')).toBeVisible()

    const logo = dialog.locator('.collectible-card-logo')
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('src', /COBBS-logo/)

    const websiteLine = dialog.locator('.collectible-card-website')
    await expect(websiteLine).toContainText('cobbsadventurepark.com')
    await expect(websiteLine).not.toContainText('→')
    await expect(dialog.locator('.collectible-card-bottom-banner svg')).toHaveCount(1) // globe icon only, no arrow icon
  })

  test('two independent device sessions (two browser contexts) have completely independent Collectible galleries', async ({
    browser,
    request,
  }) => {
    // Same two-real-contexts pattern as cobb-coins.spec.ts's isolation
    // test -- each context mints its own random device-session token
    // naturally (no manual seeding), simulating two different guests' own
    // phones rather than one shared kiosk session. earnEnoughForOnePurchase
    // alone is 25 sequential setup requests, same budget reasoning as the
    // other tests in this file that call it.
    test.setTimeout(60_000)
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    let tokenA: string | null = null
    let tokenB: string | null = null

    try {
      await pageA.goto('/')
      await pageB.goto('/')

      tokenA = await pageA.evaluate(() => localStorage.getItem('cap-device-session-id'))
      tokenB = await pageB.evaluate(() => localStorage.getItem('cap-device-session-id'))
      expect(tokenA).toBeTruthy()
      expect(tokenB).toBeTruthy()
      expect(tokenA).not.toBe(tokenB)

      await resetSessionApi(request, tokenA!)
      await resetSessionApi(request, tokenB!)

      // Session A earns and buys a card; session B never touches the
      // ledger or shop at all.
      await earnEnoughForOnePurchase(request, tokenA!)
      const { status } = await purchase(request, 'capybara', 'Jordan', tokenA!)
      expect(status).toBe(200)

      expect(await listCollectibles(request, tokenA!)).toHaveLength(1)
      expect(await listCollectibles(request, tokenB!)).toHaveLength(0)
      expect(await getCoinsTotal(request, tokenB!)).toBe(0)

      // The raw purchase above bypassed pageA's own UI entirely, so its
      // already-mounted React state still reflects its initial (empty)
      // fetch -- reload before checking the gallery, same reasoning as
      // cobb-coins.spec.ts's equivalent isolation test.
      await pageA.reload()
      await pageB.reload()

      await openNavMenu(pageA)
      await pageA.getByRole('menuitemradio', { name: 'Collectibles' }).click()
      await pageA.getByRole('tab', { name: 'Your Collection (1)' }).click()
      await expect(pageA.locator('.collectible-gallery-item')).toHaveCount(1)

      await openNavMenu(pageB)
      await pageB.getByRole('menuitemradio', { name: 'Collectibles' }).click()
      await pageB.getByRole('tab', { name: /Your Collection \(0\)/ }).click()
      await expect(pageB.getByText("You haven't collected any cards yet")).toBeVisible()

      // Resetting A must not touch B's (already-empty) gallery.
      await resetSessionApi(request, tokenA!)
      expect(await listCollectibles(request, tokenA!)).toHaveLength(0)
      expect(await listCollectibles(request, tokenB!)).toHaveLength(0)
    } finally {
      // Guaranteed cleanup regardless of where an assertion above fails --
      // Bingo completion (earnEnoughForOnePurchase completes the whole card)
      // is per-session (Phase 6a) so it can't leak into another spec file's
      // own random token, but the coins/collectibles this test earned/bought
      // are still worth tidying up on the same belt-and-suspenders principle.
      if (tokenA) await resetSessionApi(request, tokenA).catch(() => {})
      if (tokenB) await resetSessionApi(request, tokenB).catch(() => {})
      await contextA.close()
      await contextB.close()
    }
  })
})
