import { test, expect, type Locator, type Page } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { seedDeviceSession, withSession } from './deviceSessionHelper'

const API = 'http://localhost:8000'

// download.path() points at an extensionless temp artifact -- Chromium's
// file:// handler needs a real .html extension to parse (not just display
// as text) the downloaded score sheet, so save a renamed copy before
// navigating to it.
async function saveAsHtml(download: import('@playwright/test').Download): Promise<string> {
  const dest = path.join(os.tmpdir(), `${Date.now()}-${download.suggestedFilename()}`)
  await download.saveAs(dest)
  return dest
}

// Covers the turn-based Scoring Sheet redesign: enforced turn order/wrap,
// the Miss action, running score accuracy, automatic win detection for all
// three win-condition shapes (including the two confirmed tie rules -- Horse
// Hoops' bonus round, Tiki Toss' round-based multi-way tiebreak), and the
// wood-plank-styled HTML export with its per-10-round table blocks.
// Hits the real dev Supabase project via the backend, same as the other e2e
// specs -- no mocking.
//
// Per-Device Sessions Phase 2 (migration 025): score_sheet_sessions is now
// scoped to a device session, same deviceSessionHelper.ts pattern
// established for Coins/Collectibles in Phase 1. openGame mints and seeds
// an explicit token for every test and returns it, so a test that needs raw
// API calls in the same session as its own `page` can do so via withSession.

function gameCard(page: Page, gameName: string): Locator {
  // "Cornhole" is a substring of "Cornhole Extreme", so hasText alone is
  // ambiguous -- scope to the card whose *exact* heading matches.
  return page.locator('.scoring-game-card').filter({ has: page.getByRole('heading', { name: gameName, exact: true }) })
}

async function openGame(
  page: Page,
  gameName: string,
  token: string = crypto.randomUUID(),
): Promise<{ dialog: Locator; token: string }> {
  await seedDeviceSession(page, token)
  await page.goto('/')
  // Guest nav is a closed-by-default hamburger dropdown; tab buttons use an
  // explicit menuitemradio role, not the implicit button role -- see
  // cap-companion-nav-menu-e2e-regression memory.
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Scoring Sheets' }).click()
  await gameCard(page, gameName).getByRole('button', { name: 'Start Scoring' }).click()
  return { dialog: page.getByRole('dialog'), token }
}

async function beginSession(dialog: Locator, players: string[]): Promise<void> {
  const inputs = dialog.locator('.scoring-player-input')
  for (let i = 0; i < players.length; i++) {
    if ((await inputs.count()) <= i) {
      await dialog.getByRole('button', { name: 'Add Player' }).click()
    }
    await inputs.nth(i).fill(players[i])
  }
  await dialog.getByRole('button', { name: 'Begin Session' }).click()
}

function currentPlayerName(dialog: Locator): Locator {
  return dialog.locator('.scoring-current-player-panel .scoring-player-name')
}

function runningScore(dialog: Locator, playerName: string): Locator {
  return dialog.locator('.scoring-running-scores tr', { hasText: playerName }).locator('.scoring-final-totals-score')
}

// Clicks a button in the current player's action panel. The panel is shared
// by whichever player is up -- there's exactly one action panel, ever -- so
// this always scores for the current turn without needing to say who that
// is. Playwright's built-in actionability wait (the panel's buttons are
// disabled for the confirmation beat between turns) naturally blocks each
// click until the *previous* turn has actually finished advancing, so turns
// can be chained back-to-back with no manual sleep.
async function takeTurn(dialog: Locator, buttonName: string, times = 1): Promise<void> {
  const button = dialog.locator('.scoring-current-player-panel').getByRole('button', { name: buttonName, exact: true })
  for (let i = 0; i < times; i++) {
    await button.click()
  }
}

// Item 6: once a game actually ends, a dramatic win/tie moment (Bingo's
// MilestoneBanner, reused as-is) plays before the existing result screen.
// Dismissed with a click here rather than waiting out its ~2.8s auto-dismiss
// timer, to keep tests fast.
async function dismissWinAnimation(dialog: Locator, expectedText: string): Promise<void> {
  const banner = dialog.locator('.milestone-banner-blackout')
  await expect(banner).toContainText(expectedText)
  await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)
  await banner.click()
  await expect(banner).toHaveCount(0)
}

test.describe('Scoring Sheet', () => {
  test('lists all 5 turn-based games with their rules and win conditions, Archery excluded', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Scoring Sheets' }).click()

    for (const name of ['Farm Toss', 'Horse Hoops', 'Cornhole', 'Cornhole Extreme', 'Tiki Toss / Ring & Hook']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }

    await expect(page.getByRole('heading', { name: 'Archery', exact: true })).toHaveCount(0)

    await expect(gameCard(page, 'Farm Toss').getByText('First to 21 wins.')).toBeVisible()
  })

  test('turn order cycles through all players in the entered order and wraps into a new round', async ({ page }) => {
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Ann', 'Ben', 'Cid'])

    await expect(currentPlayerName(dialog)).toContainText("Ann's turn")
    const chips = dialog.locator('.scoring-turn-strip .scoring-turn-chip')
    await expect(chips).toHaveText(['Ann', 'Ben', 'Cid', 'Ann'])
    await expect(chips.first()).toHaveClass(/scoring-turn-chip-current/)

    await takeTurn(dialog, 'Miss')
    await expect(currentPlayerName(dialog)).toContainText("Ben's turn")
    await expect(chips).toHaveText(['Ben', 'Cid', 'Ann', 'Ben'])

    await takeTurn(dialog, 'Miss')
    await expect(currentPlayerName(dialog)).toContainText("Cid's turn")

    // Round 1 complete (everyone has had exactly one turn) -- wraps back to
    // the first player, in the same fixed order, for round 2.
    await takeTurn(dialog, 'Miss')
    await expect(currentPlayerName(dialog)).toContainText("Ann's turn")
    await expect(chips).toHaveText(['Ann', 'Ben', 'Cid', 'Ann'])
  })

  test('only the current player has an active action panel; Miss records 0 and still advances the turn', async ({
    page,
  }) => {
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Dee', 'Eli'])

    await expect(currentPlayerName(dialog)).toContainText("Dee's turn")
    // Exactly one action panel exists at a time -- there's no per-player row
    // to leave interactable for anyone else, by construction.
    await expect(dialog.locator('.scoring-current-player-panel')).toHaveCount(1)

    await takeTurn(dialog, 'Miss')
    await expect(runningScore(dialog, 'Dee')).toHaveText('0')
    await expect(currentPlayerName(dialog)).toContainText("Eli's turn")

    await takeTurn(dialog, '6-Point Ring (+6)')
    await expect(runningScore(dialog, 'Eli')).toHaveText('6')
    await expect(currentPlayerName(dialog)).toContainText("Dee's turn")
  })

  test('Farm Toss: running totals stay accurate across a solo player, first_to win fires on overshoot', async ({
    page,
  }) => {
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Alice'])

    const total = () => runningScore(dialog, 'Alice')
    await expect(total()).toHaveText('0')

    await takeTurn(dialog, '6-Point Ring (+6)')
    await expect(total()).toHaveText('6')

    await takeTurn(dialog, '6-Point Ring (+6)')
    await expect(total()).toHaveText('12')

    await takeTurn(dialog, '3-Point Ring (+3)')
    await expect(total()).toHaveText('15')

    // 15 + 6 = 21 exactly -- clean win, no overshoot needed here.
    await takeTurn(dialog, '6-Point Ring (+6)')

    await dismissWinAnimation(dialog, 'Alice wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Alice wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Alice' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('21')
  })

  test('Farm Toss: reaching the threshold in one overshooting entry still wins immediately', async ({ page }) => {
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Bob'])

    await takeTurn(dialog, '6-Point Ring (+6)', 3) // 18
    await takeTurn(dialog, '6-Point Ring (+6)') // 24 -- overshoots 21 on the last throw

    await dismissWinAnimation(dialog, 'Bob wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Bob wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Bob' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('24')
  })

  test('Horse Hoops: a tie at the threshold triggers a bonus round instead of declaring a winner', async ({
    page,
  }) => {
    const { dialog } = await openGame(page, 'Horse Hoops')
    await beginSession(dialog, ['Red Team', 'Blue Team'])

    // Turn order strictly alternates Red/Blue/Red/Blue/... Red reaches 10 in
    // its 3rd turn, then Misses on its next two turns to hold at 10 while
    // Blue Team's slower climb (smaller point values, needs 5 turns) catches
    // all the way up to a genuine 10-10 tie on Blue's 5th turn.
    await takeTurn(dialog, 'Red Horse Neck (+4)') // Red 4
    await takeTurn(dialog, 'Yellow Horse Neck (+3)') // Blue 3
    await takeTurn(dialog, 'Red Horse Neck (+4)') // Red 8
    await takeTurn(dialog, 'Yellow Horse Neck (+3)') // Blue 6
    await takeTurn(dialog, 'Blue Horse Neck (+2)') // Red 10
    await takeTurn(dialog, 'Blue Horse Neck (+2)') // Blue 8
    await takeTurn(dialog, 'Miss') // Red stays 10
    await takeTurn(dialog, 'Hit Horse (+1)') // Blue 9
    await takeTurn(dialog, 'Miss') // Red stays 10
    await takeTurn(dialog, 'Hit Horse (+1)') // Blue 10 -- tie!

    await expect(runningScore(dialog, 'Red Team')).toHaveText('10')
    await expect(runningScore(dialog, 'Blue Team')).toHaveText('10')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Tied at 10')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Red Team')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Blue Team')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('bonus round')

    // Sudden death: the very next point, however small, wins it outright --
    // but only provisionally (see autoFinishesOnWin / scoring_sheet.py) --
    // staff confirms with an explicit "Finish Game" tap. Round-boundary win
    // detection means this doesn't show up the instant Red pulls ahead --
    // Blue still owes this round's matching turn first.
    await expect(currentPlayerName(dialog)).toContainText("Red Team's turn")
    await takeTurn(dialog, 'Hit Horse (+1)') // Red 11 -- crosses ahead, but mid-round

    await expect(dialog.locator('.scoring-provisional-win-text')).toHaveCount(0)
    await expect(currentPlayerName(dialog)).toContainText("Blue Team's turn")

    await takeTurn(dialog, 'Miss') // Blue stays 10 -- completes the round
    await expect(dialog.locator('.scoring-provisional-win-text')).toContainText('Red Team leads with 11')
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Finish Game' }).click()

    await dismissWinAnimation(dialog, 'Red Team wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Red Team wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Red Team' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('11')
  })

  test('Horse Hoops: no bonus round when one team reaches 10 clear of the other', async ({ page }) => {
    const { dialog } = await openGame(page, 'Horse Hoops')
    await beginSession(dialog, ['Green Team', 'Gold Team'])

    await takeTurn(dialog, 'Red Horse Neck (+4)') // Green 4
    await takeTurn(dialog, 'Hit Horse (+1)') // Gold 1
    await takeTurn(dialog, 'Red Horse Neck (+4)') // Green 8
    await takeTurn(dialog, 'Hit Horse (+1)') // Gold 2
    await takeTurn(dialog, 'Blue Horse Neck (+2)') // Green 10, well clear of Gold's 2 -- but mid-round

    // Round-boundary win detection: Green crossed the threshold on their own
    // turn, but Gold hasn't taken their matching turn in this round yet --
    // the game must not show a win until Gold does.
    await expect(dialog.locator('.scoring-provisional-win-text')).toHaveCount(0)
    await expect(currentPlayerName(dialog)).toContainText("Gold Team's turn")

    await takeTurn(dialog, 'Miss') // Gold stays 2 -- completes the round
    await expect(dialog.locator('.scoring-tie-banner')).toHaveCount(0)
    await expect(dialog.locator('.scoring-provisional-win-text')).toContainText('Green Team leads with 10')
    await dialog.getByRole('button', { name: 'Finish Game' }).click()

    await dismissWinAnimation(dialog, 'Green Team wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Green Team wins!')
    await expect(dialog.locator('.scoring-tie-banner')).toHaveCount(0)
  })

  test('Tiki Toss: a multi-throw round tie stays pending, then resolves once someone wins a later round', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const { dialog } = await openGame(page, 'Tiki Toss / Ring & Hook')
    await beginSession(dialog, ['Alice', 'Bob'])

    // Round 1: both throw all Bimini (5 x 10 = 50), turns interleaved
    // Alice/Bob/Alice/Bob/... -- below the 100 threshold, so this must NOT
    // trigger any win/tie state yet.
    for (let i = 0; i < 10; i++) {
      await takeTurn(dialog, 'Bimini (+5)')
      await takeTurn(dialog, 'Bimini (+5)')
    }
    await expect(dialog.locator('.scoring-tie-banner')).toHaveCount(0)
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)
    await expect(runningScore(dialog, 'Alice')).toHaveText('50')
    await expect(runningScore(dialog, 'Bob')).toHaveText('50')

    // Round 2: both throw all Bimini again -- both land on exactly 100 at
    // the same round boundary. Per the confirmed rule ("highest score wins
    // if multiple reach 100 same round"), an exact tie must NOT declare a
    // winner -- it stays pending into another round.
    for (let i = 0; i < 10; i++) {
      await takeTurn(dialog, 'Bimini (+5)')
      await takeTurn(dialog, 'Bimini (+5)')
    }

    await expect(runningScore(dialog, 'Alice')).toHaveText('100')
    await expect(runningScore(dialog, 'Bob')).toHaveText('100')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Tied after round 2')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Alice')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Bob')
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)

    // Round 3 (the tiebreak round): Alice keeps throwing Bimini (+50, total
    // 150), Bob throws the lower-value Nassau instead (+30, total 130).
    // Alice pulls strictly ahead at this round's boundary and wins the game
    // outright -- "someone wins a round" per the confirmed rule.
    for (let i = 0; i < 10; i++) {
      await takeTurn(dialog, 'Bimini (+5)')
      await takeTurn(dialog, 'Nassau (+3)')
    }

    await dismissWinAnimation(dialog, 'Alice wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Alice wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Alice' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('150')
  })

  test('finishing a session offers a wood-plank-styled downloadable HTML score sheet', async ({ page }) => {
    const { dialog } = await openGame(page, 'Cornhole')
    await beginSession(dialog, ['Casey'])

    await takeTurn(dialog, 'Cornhole (+3)', 7) // 21 exactly
    await dismissWinAnimation(dialog, 'Casey wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Casey wins!')

    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download Summary' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('cornhole-score-sheet.html')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const html = Buffer.concat(chunks).toString('utf-8')

    expect(html).toContain("Cobb's Adventure Park — Cornhole")
    expect(html).toContain('Winner: Casey')
    expect(html).toContain('Rounds 1–10')
    // "Round Total" column is deliberately removed -- only per-round scores
    // plus a single running Total column remain.
    expect(html).not.toContain('Round Total')
    // One round block only (7 rounds fits in the first block of 10).
    expect(html).not.toContain('Rounds 11–20')

    // Save and open the downloaded file directly to confirm the wood-grain
    // treatment actually renders, not just that the markup/class exists.
    const savedPath = await saveAsHtml(download)
    const filePage = await page.context().newPage()
    await filePage.goto(pathToFileURL(savedPath).href)
    const woodBackground = await filePage.locator('.wood-frame').evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(woodBackground).toContain('linear-gradient')
    const parchmentBg = await filePage.locator('.parchment').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(parchmentBg).toBe('rgb(240, 222, 192)')
    await filePage.close()
  })

  test('score sheet export wraps into new table blocks every 10 rounds, even at a high round count', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Marathon'])

    // 55 rounds of nothing but misses (0 points each) -- stress the "misses
    // can push a game into hundreds of rounds before anyone reaches the win
    // threshold" case from the redesign, without needing hundreds of real
    // clicks for this test to stay reasonably fast.
    await takeTurn(dialog, 'Miss', 55)
    await expect(runningScore(dialog, 'Marathon')).toHaveText('0')

    // Now actually win it: 4 x 6 = 24, crossing the 21 threshold at round 59.
    await takeTurn(dialog, '6-Point Ring (+6)', 4)
    await dismissWinAnimation(dialog, 'Marathon wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Marathon wins!')

    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download Summary' }).click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const html = Buffer.concat(chunks).toString('utf-8')

    // 59 rounds played -> blocks for 1-10, 11-20, 21-30, 31-40, 41-50, 51-60.
    for (const range of ['1–10', '11–20', '21–30', '31–40', '41–50', '51–60']) {
      expect(html).toContain(`Rounds ${range}`)
    }
    expect(html).not.toContain('Rounds 61–70')
    expect(html).toContain('Winner: Marathon')

    const savedPath = await saveAsHtml(download)
    const filePage = await page.context().newPage()
    await filePage.goto(pathToFileURL(savedPath).href)
    // Six round-block tables should have actually rendered, not just be
    // present as unparsed markup.
    await expect(filePage.locator('table.round-block')).toHaveCount(6)
    await filePage.close()
  })

  test('Farm Toss: crossing the threshold mid-round waits for the round to finish before declaring a winner', async ({
    page,
  }) => {
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Xan', 'Yui'])

    await takeTurn(dialog, '6-Point Ring (+6)') // Xan 6
    await takeTurn(dialog, 'Miss') // Yui 0
    await takeTurn(dialog, '6-Point Ring (+6)') // Xan 12
    await takeTurn(dialog, 'Miss') // Yui 0
    await takeTurn(dialog, '6-Point Ring (+6)') // Xan 18
    await takeTurn(dialog, 'Miss') // Yui 0
    await takeTurn(dialog, '3-Point Ring (+3)') // Xan 21 -- crosses the threshold, but mid-round

    // Round-boundary win detection (non-tiebreak game): Xan crossed 21 on
    // their own turn, but Yui only has 3 turns so far this round -- the
    // game must not end until Yui's matching 4th turn completes the round.
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)
    await expect(dialog.locator('.milestone-banner')).toHaveCount(0)
    await expect(currentPlayerName(dialog)).toContainText("Yui's turn")
    await expect(runningScore(dialog, 'Xan')).toHaveText('21')

    await takeTurn(dialog, 'Miss') // Yui 0 -- completes the round; only now does the game end
    await dismissWinAnimation(dialog, 'Xan wins!')
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Xan wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Xan' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('21')
  })

  test('taking a turn hides the action buttons behind a big result message for the beat, then reveals the next turn', async ({
    page,
  }) => {
    const { dialog } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['PJ', 'Q'])

    await dialog
      .locator('.scoring-current-player-panel')
      .getByRole('button', { name: '6-Point Ring (+6)', exact: true })
      .click()

    // Buttons genuinely removed from the DOM, not just visually hidden.
    await expect(dialog.locator('.scoring-event-buttons')).toHaveCount(0)
    await expect(dialog.locator('.scoring-turn-result-text')).toContainText('PJ scored 6 points!')

    await expect(currentPlayerName(dialog)).toContainText("Q's turn")
    await expect(dialog.locator('.scoring-turn-result-text')).toHaveCount(0)
    await expect(dialog.locator('.scoring-event-buttons')).toBeVisible()

    await dialog.locator('.scoring-current-player-panel').getByRole('button', { name: 'Miss', exact: true }).click()
    await expect(dialog.locator('.scoring-turn-result-text')).toContainText('Maybe next shot, Q!')
    await expect(currentPlayerName(dialog)).toContainText("PJ's turn")
  })

  test('scoring buttons use the parchment/sunset-orange palette, turn order shows arrows, and nothing overflows on mobile', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      const { dialog } = await openGame(page, 'Farm Toss')
      await beginSession(dialog, ['Amy', 'Bo', 'Cal'])

      // Item 1: the wash-tinted sunset-orange treatment, not the old plain
      // black-outlined default .btn fill.
      const scoreButton = dialog
        .locator('.scoring-current-player-panel')
        .getByRole('button', { name: '6-Point Ring (+6)', exact: true })
      const bg = await scoreButton.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe('rgb(255, 255, 255)')
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')

      // Item 2: arrows separate the (always-4) turn-order chips.
      await expect(dialog.locator('.scoring-turn-strip .scoring-turn-chip')).toHaveCount(4)
      await expect(dialog.locator('.scoring-turn-strip .scoring-turn-arrow')).toHaveCount(3)

      // Item 3: the action buttons stay within the dialog panel's bounds --
      // no left-hugging overflow, at either viewport size.
      const panelBox = await dialog.boundingBox()
      const buttonsBox = await dialog.locator('.scoring-event-buttons').boundingBox()
      expect(panelBox).not.toBeNull()
      expect(buttonsBox).not.toBeNull()
      if (panelBox && buttonsBox) {
        expect(buttonsBox.x).toBeGreaterThanOrEqual(panelBox.x - 1)
        expect(buttonsBox.x + buttonsBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
      }

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      expect(hasHorizontalOverflow).toBe(false)
    }
  })

  test('two independent device sessions have completely independent Scoring Sheet sessions and entries', async ({
    page,
    request,
  }) => {
    const { dialog, token: tokenA } = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Alice'])
    await takeTurn(dialog, '6-Point Ring (+6)') // Alice 6, session A now has one entry

    const gamesRes = await request.get(`${API}/scoring/games`, withSession(tokenA))
    const games = (await gamesRes.json()) as { id: string; name: string; score_events: { id: string }[] }[]
    const farmToss = games.find((g) => g.name === 'Farm Toss')!

    const createRes = await request.post(`${API}/scoring/sessions`, {
      ...withSession(tokenA),
      data: { game_id: farmToss.id, players: ['Raw Alice'] },
    })
    expect(createRes.ok()).toBe(true)
    const rawSession = (await createRes.json()) as { id: string }

    // Owning device fetches its own raw-created session fine.
    const ownFetch = await request.get(`${API}/scoring/sessions/${rawSession.id}`, withSession(tokenA))
    expect(ownFetch.ok()).toBe(true)

    // A second device, with its own token, gets a 404 for that same session
    // id -- not the session's data, and not a 403 that would confirm it
    // exists -- same "existence not leaked" behavior as a bogus id.
    const tokenB = crypto.randomUUID()
    const foreignFetch = await request.get(`${API}/scoring/sessions/${rawSession.id}`, withSession(tokenB))
    expect(foreignFetch.status()).toBe(404)

    // Recording an entry against it from the foreign device is blocked too,
    // not silently accepted onto the wrong session.
    const eventId = farmToss.score_events[0].id
    const foreignEntryRes = await request.post(`${API}/scoring/sessions/${rawSession.id}/entries`, {
      ...withSession(tokenB),
      data: { player_name: 'Raw Alice', score_event_id: eventId },
    })
    expect(foreignEntryRes.status()).toBe(404)

    // Session B starts its own, entirely separate Farm Toss session through
    // the UI -- a fresh scorecard with no trace of session A's players or
    // entries, confirming the isolation holds through the real UI path too,
    // not just the raw-request checks above.
    const { dialog: dialogB } = await openGame(page, 'Farm Toss', tokenB)
    await beginSession(dialogB, ['Bob'])
    await expect(runningScore(dialogB, 'Bob')).toHaveText('0')
    await expect(dialogB.getByText('Alice')).toHaveCount(0)
    await expect(dialogB.getByText('Raw Alice')).toHaveCount(0)
  })
})
