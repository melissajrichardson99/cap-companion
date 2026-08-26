import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

// Covers the Cobb Coins spend side (migration 022_collectible_cards.sql):
// purchasing a Collectible Card deducts coins and adds it to the gallery,
// insufficient coins blocks the purchase, repeat purchases of the same
// animal each get their own independent guest_name, Reset Session clears
// the gallery, and the card artwork uses the real app logo with no arrow
// element (the two explicit deviations from the reference mockup).
//
// Same self-resetting pattern as cobb-coins.spec.ts (a raw POST to
// /session/reset before driving anything) -- bulk/precise ledger math is
// exercised via raw HTTP against the same endpoints the UI calls; a couple
// of scenarios also drive the real UI end to end to prove the shop/reveal/
// gallery actually render.

const API = 'http://localhost:8000'

async function openNavMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
}

async function expectCoinTotal(page: Page, total: number): Promise<void> {
  await openNavMenu(page)
  await expect(page.locator('.nav-menu-coins')).toHaveText(`🪙 ${total} Cobb Coins`)
}

async function resetSessionApi(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API}/session/reset`)
  expect(res.ok()).toBe(true)
}

async function getCoinsTotal(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${API}/coins/summary`)
  const body = (await res.json()) as { total: number }
  return body.total
}

async function getBingoCardId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/bingo/cards`)
  const cards = (await res.json()) as { id: string }[]
  return cards[0].id
}

async function getBingoTileIds(request: APIRequestContext, cardId: string): Promise<string[]> {
  const res = await request.get(`${API}/bingo/card/${cardId}`)
  const card = (await res.json()) as { tiles: { id: string }[] }
  return card.tiles.map((t) => t.id)
}

// Enough for a single standard-tier (100) purchase, via one earn-side
// endpoint only -- completing the whole bingo card (130, see
// cobb-coins.spec.ts) over raw HTTP. Kept deliberately cheap (25 sequential
// calls) for the tests below that also drive real UI afterward and need to
// fit inside Playwright's global per-test timeout.
async function earnEnoughForOnePurchase(request: APIRequestContext): Promise<void> {
  const cardId = await getBingoCardId(request)
  const tileIds = await getBingoTileIds(request, cardId)
  for (const tileId of tileIds) {
    await request.post(`${API}/bingo/tiles/${tileId}/complete`)
  }
}

// Enough for two standard-tier (100 each) purchases -- the bingo card (130)
// plus the 4 Scavenger Hunt characters that don't require a QR-unlock scan
// first (60) clears 190 on its own; one Puzzle Timer attempt (+12 at 0
// hints) pushes it past 200.
async function earnPlentyOfCoins(request: APIRequestContext): Promise<void> {
  await earnEnoughForOnePurchase(request)

  const charactersRes = await request.get(`${API}/hunt/characters`)
  const characters = (await charactersRes.json()) as { id: string; name: string; challenges: { id: string }[] }[]
  for (const character of characters.filter((c) => c.name !== 'Pig')) {
    for (const challenge of character.challenges) {
      await request.post(`${API}/hunt/challenges/${challenge.id}/complete`)
    }
  }

  const puzzlesRes = await request.get(`${API}/puzzles`)
  const puzzles = (await puzzlesRes.json()) as { challenges: { id: string }[] }[]
  const challengeId = puzzles[0].challenges[0].id
  await request.post(`${API}/puzzles/challenges/${challengeId}/attempts`, {
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
): Promise<{ status: number; body: CollectibleCardRow | { detail: string } }> {
  const res = await request.post(`${API}/collectibles/purchase`, {
    data: { animal_slug: animalSlug, guest_name: guestName },
  })
  return { status: res.status(), body: await res.json() }
}

async function listCollectibles(request: APIRequestContext): Promise<CollectibleCardRow[]> {
  const res = await request.get(`${API}/collectibles`)
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
    await resetSessionApi(request)
    await earnPlentyOfCoins(request)
    const totalBefore = await getCoinsTotal(request)

    const { status, body } = await purchase(request, 'capybara', 'Jordan')
    expect(status).toBe(200)
    const card = body as CollectibleCardRow
    expect(card.animal_slug).toBe('capybara')
    expect(card.guest_name).toBe('Jordan')
    expect(card.coins_spent).toBe(100)

    expect(await getCoinsTotal(request)).toBe(totalBefore - 100)
    const cards = await listCollectibles(request)
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
    await resetSessionApi(request)
    expect(await getCoinsTotal(request)).toBe(0)

    const { status, body } = await purchase(request, 'capybara', 'Nobody')
    expect(status).toBe(409)
    expect((body as { detail: string }).detail).toMatch(/not enough/i)
    expect(await getCoinsTotal(request)).toBe(0)
    expect(await listCollectibles(request)).toHaveLength(0)

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
    // earnPlentyOfCoins alone is ~45 sequential setup requests -- right at
    // the edge of the default per-test budget.
    test.setTimeout(45_000)
    await resetSessionApi(request)
    await earnPlentyOfCoins(request)

    const first = await purchase(request, 'sloth', 'Jordan')
    expect(first.status).toBe(200)
    const second = await purchase(request, 'sloth', 'Alex')
    expect(second.status).toBe(200)

    const cards = await listCollectibles(request)
    const slothCards = cards.filter((c) => c.animal_slug === 'sloth')
    expect(slothCards).toHaveLength(2)
    const names = slothCards.map((c) => c.guest_name).sort()
    expect(names).toEqual(['Alex', 'Jordan'])
  })

  test('Reset Session clears the gallery and does not restore prior collectibles', async ({ page, request }) => {
    test.setTimeout(60_000)
    await resetSessionApi(request)
    await earnEnoughForOnePurchase(request)
    await purchase(request, 'capybara', 'Jordan')
    expect(await listCollectibles(request)).toHaveLength(1)

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

    expect(await listCollectibles(request)).toHaveLength(0)

    await page.getByRole('menuitemradio', { name: 'Collectibles' }).click()
    await page.getByRole('tab', { name: /Your Collection \(0\)/ }).click()
    await expect(page.getByText("You haven't collected any cards yet")).toBeVisible()
  })

  test('the card uses the real app logo and has no arrow element in the bottom banner', async ({ page, request }) => {
    test.setTimeout(60_000)
    await resetSessionApi(request)
    await earnEnoughForOnePurchase(request)

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
})
