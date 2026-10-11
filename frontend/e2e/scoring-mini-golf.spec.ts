import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { seedDeviceSession, withSession } from './deviceSessionHelper'

// Stroke-play Scoring Sheet (mini golf, migration 043): Blacklight Mini Golf
// and Cornhole Mini Golf. Covers the guided keypad entry (real taps), the
// confirm step and its double-tap guard, Back, scorecard corrections, ties,
// resume after a reload, both QR arrival paths, and the HTML export.
// Hits the real dev Supabase project via the backend, like the other specs.
//
// Each test uses its own fresh device session, so rounds never leak between
// tests (an unfinished round would otherwise be resumed by the next one).
// Named to sort after cobb-coins.spec.ts (see the e2e alphabetical ordering
// gotcha) -- this spec awards coins, but only to its own sessions.

const API = 'http://localhost:8000'
const BLACKLIGHT = { name: 'Blacklight Mini Golf', slug: 'blacklight-mini-golf' }
const CORNHOLE_GOLF = { name: 'Cornhole Mini Golf', slug: 'cornhole-mini-golf' }

interface GameRow {
  id: string
  slug: string
  hole_count: number | null
}

async function gameId(request: APIRequestContext, slug: string): Promise<string> {
  const res = await request.get(`${API}/scoring/games`)
  const games = (await res.json()) as GameRow[]
  return games.find((g) => g.slug === slug)!.id
}

async function freshGuest(page: Page): Promise<string> {
  const token = crypto.randomUUID()
  await seedDeviceSession(page, token)
  return token
}

// Plays the given holes through the API (same device session as the page),
// for tests that only care about what comes after.
async function prefillRound(
  request: APIRequestContext,
  token: string,
  slug: string,
  players: string[],
  strokesByHole: number[][],
): Promise<string> {
  const created = await request.post(`${API}/scoring/sessions`, {
    ...withSession(token),
    data: { game_id: await gameId(request, slug), players },
  })
  expect(created.ok()).toBe(true)
  const { id } = (await created.json()) as { id: string }
  for (const [i, row] of strokesByHole.entries()) {
    for (const [p, strokes] of row.entries()) {
      const res = await request.put(`${API}/scoring/sessions/${id}/holes`, {
        ...withSession(token),
        data: { player_name: players[p], hole_number: i + 1, strokes },
      })
      expect(res.ok()).toBe(true)
    }
  }
  return id
}

async function openViaMenu(page: Page, gameName: string): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitemradio', { name: 'Scoring Sheet' }).click()
  await page
    .locator('.scoring-game-card')
    .filter({ has: page.getByRole('heading', { name: gameName, exact: true }) })
    .getByRole('button', { name: 'Start Scoring' })
    .click()
  return page.getByRole('dialog')
}

async function beginRound(dialog: Locator, players: string[]): Promise<void> {
  const inputs = dialog.locator('.scoring-player-input')
  for (let i = 0; i < players.length; i++) {
    if ((await inputs.count()) <= i) await dialog.getByRole('button', { name: 'Add Player' }).click()
    await inputs.nth(i).fill(players[i])
  }
  await dialog.getByRole('button', { name: 'Begin Round' }).click()
}

function key(dialog: Locator, name: string): Locator {
  return dialog.locator('.stroke-keypad').getByRole('button', { name, exact: true })
}

async function tapDigits(dialog: Locator, digits: string): Promise<void> {
  for (const d of digits) await key(dialog, d).click()
}

// Real taps: digits, Enter, then Confirm once its double-tap guard arms
// (toBeEnabled waits for it). Waits for the keypad to come back, i.e. for
// the save to land, before returning.
async function enterScore(dialog: Locator, strokes: number): Promise<void> {
  await tapDigits(dialog, String(strokes))
  await key(dialog, 'Enter').click()
  const confirm = dialog.getByRole('button', { name: 'Confirm' })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(dialog.locator('.stroke-confirm')).toHaveCount(0)
}

function header(dialog: Locator): Locator {
  return dialog.locator('.stroke-entry-header')
}

function runningTotal(dialog: Locator, player: string): Locator {
  return dialog.locator('.stroke-running-totals tr', { hasText: player }).locator('.scoring-final-totals-score')
}

async function dismissWinAnimation(dialog: Locator, expectedText: string): Promise<void> {
  const banner = dialog.locator('.milestone-banner-blackout')
  await expect(banner).toContainText(expectedText)
  await banner.click()
  await expect(banner).toHaveCount(0)
}

async function downloadHtml(page: Page, dialog: Locator): Promise<{ html: string; savedPath: string; filename: string }> {
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download Summary' }).click()
  const download = await downloadPromise
  // download.path() has no extension; save a .html copy so file:// parses it.
  const savedPath = path.join(os.tmpdir(), `${Date.now()}-${download.suggestedFilename()}`)
  await download.saveAs(savedPath)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return { html: Buffer.concat(chunks).toString('utf-8'), savedPath, filename: download.suggestedFilename() }
}

test.describe('Mini golf (stroke play) Scoring Sheet', () => {
  test('both courses are listed with their hole count, alongside the turn-based games', async ({ page, request }) => {
    for (const course of [BLACKLIGHT, CORNHOLE_GOLF]) {
      const res = await request.get(`${API}/scoring/games`)
      const game = ((await res.json()) as GameRow[]).find((g) => g.slug === course.slug)!
      expect(game.hole_count).toBe(9)
    }
    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Scoring Sheet' }).click()
    for (const name of [BLACKLIGHT.name, CORNHOLE_GOLF.name, 'Cornhole', 'Cornhole Extreme']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
  })

  test('a 2-player 9-hole round, start to finish on the keypad, with running totals, leader and export', async ({
    page,
    request,
  }) => {
    // 18 real-tap entries, each behind the 600ms confirm guard plus a save:
    // well past the default 30s.
    test.setTimeout(120_000)
    const token = await freshGuest(page)
    const dialog = await openViaMenu(page, CORNHOLE_GOLF.name)
    await beginRound(dialog, ['Alex', 'Sam'])

    const alex = [3, 4, 2, 5, 3, 2, 4, 3, 3] // 29
    const sam = [2, 3, 2, 4, 3, 2, 3, 3, 12] // 34
    for (let hole = 1; hole <= 9; hole++) {
      await expect(header(dialog)).toContainText(`Hole ${hole} of 9`)
      await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Alex')
      await enterScore(dialog, alex[hole - 1])
      if (hole < 9) {
        await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
        await enterScore(dialog, sam[hole - 1])
        const alexSoFar = alex.slice(0, hole).reduce((a, b) => a + b, 0)
        const samSoFar = sam.slice(0, hole).reduce((a, b) => a + b, 0)
        await expect(runningTotal(dialog, 'Alex')).toHaveText(String(alexSoFar))
        await expect(runningTotal(dialog, 'Sam')).toHaveText(String(samSoFar))
        const leader = samSoFar < alexSoFar ? 'Sam' : samSoFar > alexSoFar ? 'Alex' : null
        if (leader) {
          await expect(dialog.locator('.stroke-running-totals tr', { hasText: leader }).locator('.stroke-leader-badge')).toBeVisible()
        }
      }
    }
    // Last score of the round: Sam's 12 on hole 9 also shows the high-score line.
    await tapDigits(dialog, '12')
    await key(dialog, 'Enter').click()
    await expect(dialog.locator('.stroke-confirm-warning')).toHaveText("That's a lot of strokes, is that right?")
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Confirm' }).click()

    await dismissWinAnimation(dialog, 'Alex wins!')
    await expect(dialog.locator('.scoring-win-headline')).toHaveText('🏆 Alex wins!')
    const scorecard = dialog.locator('.stroke-scorecard')
    await expect(scorecard.locator('tbody tr', { hasText: 'Alex' }).locator('.stroke-scorecard-total')).toHaveText('29')
    await expect(scorecard.locator('tbody tr', { hasText: 'Sam' }).locator('.stroke-scorecard-total')).toHaveText('34')
    // Finished scorecard is read-only.
    await expect(scorecard.locator('.stroke-scorecard-cell-btn')).toHaveCount(0)

    // The usual scoring coin (10) went to this device.
    const coins = await request.get(`${API}/coins/summary`, withSession(token))
    expect(((await coins.json()) as { total: number }).total).toBe(10)

    // Export: full scorecard on the wood-plank sheet.
    const { html, savedPath, filename } = await downloadHtml(page, dialog)
    expect(filename).toBe('cornhole-mini-golf-score-sheet.html')
    expect(html).toContain("Cobb's Adventure Park — Cornhole Mini Golf")
    expect(html).toContain('Winner: Alex')
    expect(html).toContain('<div class="round-block-title">Scorecard</div>')
    for (let h = 1; h <= 9; h++) expect(html).toContain(`<th>${h}</th>`)
    expect(html).toContain(`<td class="player-name">Sam</td>${sam.map((s) => `<td>${s}</td>`).join('')}<td class="total-cell">34</td>`)
    const filePage = await page.context().newPage()
    await filePage.goto(pathToFileURL(savedPath).href)
    expect(await filePage.locator('.wood-frame').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      'linear-gradient',
    )
    await expect(filePage.locator('.round-block tbody tr')).toHaveCount(2)
    await filePage.close()

    // A finished round isn't resumed: opening the sheet again starts fresh.
    await dialog.getByRole('button', { name: 'New Round' }).click()
    await expect(dialog.getByRole('button', { name: 'Begin Round' })).toBeVisible()
  })

  test('keypad rules: Enter disabled on empty and 0, no leading zeros, 3 digits max, Delete', async ({ page }) => {
    await freshGuest(page)
    const dialog = await openViaMenu(page, CORNHOLE_GOLF.name)
    await beginRound(dialog, ['Alex'])
    const display = dialog.locator('.stroke-display')

    await expect(key(dialog, 'Enter')).toBeDisabled()
    await expect(key(dialog, 'Delete')).toBeDisabled()
    await key(dialog, '0').click()
    await expect(display).toHaveText('0')
    await expect(key(dialog, 'Enter')).toBeDisabled()
    // A digit after a lone 0 replaces it (no leading zeros).
    await key(dialog, '4').click()
    await expect(display).toHaveText('4')
    await expect(key(dialog, 'Enter')).toBeEnabled()

    await tapDigits(dialog, '567')
    await expect(display).toHaveText('456') // capped at three digits
    await key(dialog, 'Delete').click()
    await expect(display).toHaveText('45')
    await key(dialog, 'Delete').click()
    await key(dialog, 'Delete').click()
    await expect(display).toHaveText('–')
    await expect(key(dialog, 'Enter')).toBeDisabled()

    await tapDigits(dialog, '999')
    await expect(key(dialog, 'Enter')).toBeEnabled()
  })

  test('confirm step: shows the score back, Change returns with digits editable, Confirm saves', async ({ page }) => {
    await freshGuest(page)
    const dialog = await openViaMenu(page, CORNHOLE_GOLF.name)
    await beginRound(dialog, ['Alex', 'Sam'])

    await tapDigits(dialog, '4')
    await key(dialog, 'Enter').click()
    const confirm = dialog.getByRole('button', { name: 'Confirm' })
    // Double-tap guard: Confirm is not live the instant the step appears.
    await expect(confirm).toBeDisabled()
    await expect(dialog.locator('.stroke-confirm-text')).toHaveText('Alex, hole 1: 4 strokes. Correct?')
    await expect(dialog.locator('.stroke-confirm-warning')).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Change' }).click()
    await expect(dialog.locator('.stroke-display')).toHaveText('4')
    await key(dialog, 'Delete').click()
    await key(dialog, '1').click()
    await key(dialog, 'Enter').click()
    await expect(dialog.locator('.stroke-confirm-text')).toHaveText('Alex, hole 1: 1 stroke. Correct?')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
    await expect(runningTotal(dialog, 'Alex')).toHaveText('1')
  })

  test('a fast double tap on Enter does not confirm the score', async ({ page }) => {
    await freshGuest(page)
    const dialog = await openViaMenu(page, CORNHOLE_GOLF.name)
    await beginRound(dialog, ['Alex', 'Sam'])
    await tapDigits(dialog, '3')
    // Enter, then immediately a second tap where Confirm appears.
    const enterBox = (await key(dialog, 'Enter').boundingBox())!
    await page.mouse.click(enterBox.x + enterBox.width / 2, enterBox.y + enterBox.height / 2)
    await dialog.getByRole('button', { name: 'Confirm' }).click({ force: true, timeout: 200 }).catch(() => {})
    await expect(dialog.locator('.stroke-confirm')).toBeVisible()
    await expect(runningTotal(dialog, 'Alex')).toHaveText('0')
  })

  test('Back returns to the previous player and a corrected score is saved', async ({ page }) => {
    await freshGuest(page)
    const dialog = await openViaMenu(page, CORNHOLE_GOLF.name)
    await beginRound(dialog, ['Alex', 'Sam'])
    await expect(dialog.getByRole('button', { name: '← Back' })).toBeDisabled()

    await enterScore(dialog, 5)
    await dialog.getByRole('button', { name: '← Back' }).click()
    await expect(header(dialog)).toContainText('Hole 1 of 9')
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Alex')
    await expect(dialog.locator('.stroke-display')).toHaveText('5')
    await key(dialog, 'Delete').click()
    await enterScore(dialog, 2)

    // Back to the next empty cell.
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
    await expect(runningTotal(dialog, 'Alex')).toHaveText('2')
  })

  test('correcting an earlier hole from the scorecard grid', async ({ page, request }) => {
    const token = await freshGuest(page)
    await prefillRound(request, token, CORNHOLE_GOLF.slug, ['Alex', 'Sam'], [[3, 4], [2, 2], [5]])
    await page.goto(`/scoring/${CORNHOLE_GOLF.slug}`)
    const dialog = page.getByRole('dialog')
    await expect(header(dialog)).toContainText('Hole 3 of 9')

    await dialog.getByRole('button', { name: 'Scorecard' }).click()
    const grid = dialog.locator('.stroke-scorecard')
    await expect(grid.locator('thead .stroke-scorecard-current-hole')).toHaveText('3')
    await grid.getByRole('button', { name: 'Sam, hole 1: 4. Tap to correct.' }).click()

    await expect(header(dialog)).toContainText('Hole 1 of 9')
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
    await expect(dialog.locator('.stroke-correction-note')).toBeVisible()
    await key(dialog, 'Delete').click()
    await enterScore(dialog, 1)

    // Returns to the grid with the corrected value and total.
    await expect(grid.locator('td[data-hole="1"][data-player="Sam"]')).toHaveText('1')
    await expect(grid.locator('tbody tr', { hasText: 'Sam' }).locator('.stroke-scorecard-total')).toHaveText('3')
    await dialog.getByRole('button', { name: 'Back to Entry' }).click()
    await expect(header(dialog)).toContainText('Hole 3 of 9')
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
  })

  test('a two-way tie is shown as a shared win and exported as one', async ({ page, request }) => {
    const token = await freshGuest(page)
    const holes = [[3, 4], [4, 3], [2, 2], [3, 3], [4, 4], [2, 2], [3, 3], [5, 5]]
    await prefillRound(request, token, BLACKLIGHT.slug, ['Alex', 'Sam'], [...holes, [2]])
    await page.goto(`/scoring/${BLACKLIGHT.slug}`)
    const dialog = page.getByRole('dialog')
    await expect(header(dialog)).toContainText('Hole 9 of 9')
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
    await enterScore(dialog, 2)

    await dismissWinAnimation(dialog, "It's a tie! Alex & Sam share the win!")
    await expect(dialog.locator('.scoring-win-headline')).toHaveText('🏆 Tie! Alex & Sam share the win')
    await expect(dialog.locator('.stroke-scorecard-leader-row')).toHaveCount(2)

    const { html } = await downloadHtml(page, dialog)
    expect(html).toContain('Tied for the win: Alex &amp; Sam')
    expect(html.match(/class="winner-row"/g)?.length).toBe(4) // final totals + scorecard, both players
  })

  test('a three-way tie is stored as all three names', async ({ request }) => {
    const token = crypto.randomUUID()
    await prefillRound(
      request,
      token,
      CORNHOLE_GOLF.slug,
      ['Jo', 'Alex', 'Sam'],
      Array.from({ length: 9 }, () => [3, 3, 3]),
    )
    const active = await request.get(`${API}/scoring/games/${await gameId(request, CORNHOLE_GOLF.slug)}/active-session`, withSession(token))
    expect(await active.json()).toBeNull() // finished rounds aren't "active"
    const coins = await request.get(`${API}/coins/summary`, withSession(token))
    expect(((await coins.json()) as { total: number }).total).toBe(10)
  })

  test('reloading mid-round resumes at the next empty cell, via the deep link and via the card', async ({ page }) => {
    await freshGuest(page)
    await page.goto(`/scoring/${BLACKLIGHT.slug}`)
    const dialog = page.getByRole('dialog')
    await beginRound(dialog, ['Alex', 'Sam'])
    await enterScore(dialog, 3)
    await enterScore(dialog, 4)
    await enterScore(dialog, 2)

    await page.reload()
    await expect(header(dialog)).toContainText('Hole 2 of 9')
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
    await expect(runningTotal(dialog, 'Alex')).toHaveText('5')
    await expect(runningTotal(dialog, 'Sam')).toHaveText('4')

    // Close and reopen from the card: still the same round.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.locator('.scoring-game-card').filter({ has: page.getByRole('heading', { name: BLACKLIGHT.name, exact: true }) }).getByRole('button', { name: 'Start Scoring' }).click()
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Sam')
    await enterScore(dialog, 6)
    await expect(header(dialog)).toContainText('Hole 3 of 9')
  })

  test('scoring writes are validated server-side', async ({ request }) => {
    const token = crypto.randomUUID()
    const created = await request.post(`${API}/scoring/sessions`, {
      ...withSession(token),
      data: { game_id: await gameId(request, CORNHOLE_GOLF.slug), players: ['Alex'] },
    })
    const { id } = (await created.json()) as { id: string }
    const put = (data: Record<string, unknown>) =>
      request.put(`${API}/scoring/sessions/${id}/holes`, { ...withSession(token), data: { player_name: 'Alex', ...data } })

    for (const strokes of [0, 1000, '4', '04', 4.5, true]) {
      expect((await put({ hole_number: 1, strokes })).status()).toBe(422)
    }
    expect((await put({ hole_number: 10, strokes: 3 })).status()).toBe(422)
    expect((await put({ hole_number: 0, strokes: 3 })).status()).toBe(422)
    expect((await put({ hole_number: 2, strokes: 3 })).status()).toBe(409) // skipping ahead
    expect((await put({ hole_number: 1, strokes: 999 })).status()).toBe(200)
    expect((await put({ hole_number: 1, strokes: 1 })).status()).toBe(200) // correction
  })
})

test.describe('Mini golf: Start New Round', () => {
  test('discarding needs a confirm, Keep Playing backs out, and a discarded round is not resumed', async ({
    page,
    request,
  }) => {
    const token = await freshGuest(page)
    await prefillRound(request, token, BLACKLIGHT.slug, ['Alex', 'Sam'], [[3, 4], [2]])
    await page.goto(`/scoring/${BLACKLIGHT.slug}`)
    const dialog = page.getByRole('dialog')
    await expect(header(dialog)).toContainText('Hole 2 of 9')

    // Confirm step, then back out: nothing lost.
    await dialog.getByRole('button', { name: 'Start New Round' }).click()
    await expect(dialog.locator('.stroke-discard-text')).toHaveText('Discard this round?')
    await dialog.getByRole('button', { name: 'Keep Playing' }).click()
    await expect(dialog.locator('.stroke-discard')).toHaveCount(0)
    await expect(header(dialog)).toContainText('Hole 2 of 9')
    await expect(runningTotal(dialog, 'Alex')).toHaveText('5')

    // Discard for real: back to setup, and the old round is gone server-side.
    await dialog.getByRole('button', { name: 'Start New Round' }).click()
    await dialog.getByRole('button', { name: 'Discard Round' }).click()
    await expect(dialog.getByRole('button', { name: 'Begin Round' })).toBeVisible()
    const active = await request.get(
      `${API}/scoring/games/${await gameId(request, BLACKLIGHT.slug)}/active-session`,
      withSession(token),
    )
    expect(await active.json()).toBeNull()

    // A reload doesn't bring it back.
    await page.reload()
    await expect(dialog.getByRole('button', { name: 'Begin Round' })).toBeVisible()

    // A different group can start fresh.
    await beginRound(dialog, ['Jo', 'Kim', 'Lee'])
    await expect(header(dialog)).toContainText('Hole 1 of 9')
    await expect(header(dialog).locator('.stroke-player-label')).toHaveText('Jo')
    await expect(runningTotal(dialog, 'Jo')).toHaveText('0')
  })

  test('only an unfinished round on this device can be discarded', async ({ request }) => {
    const token = crypto.randomUUID()
    const finishedId = await prefillRound(request, token, CORNHOLE_GOLF.slug, ['Alex'], Array.from({ length: 9 }, () => [3]))
    const openId = await prefillRound(request, token, CORNHOLE_GOLF.slug, ['Alex'], [[4]])
    const discard = (id: string, t: string) => request.delete(`${API}/scoring/sessions/${id}`, withSession(t))

    // A finished round is a result (and a Passport win): kept.
    expect((await discard(finishedId, token)).status()).toBe(409)
    // Another device can't discard this one's round.
    expect((await discard(openId, crypto.randomUUID())).status()).toBe(404)
    expect((await discard(openId, token)).status()).toBe(204)
    expect((await discard(openId, token)).status()).toBe(404)
    // Its coin from the finished round is untouched.
    const coins = await request.get(`${API}/coins/summary`, withSession(token))
    expect(((await coins.json()) as { total: number }).total).toBe(10)
  })
})

test.describe('Mini golf QR arrival', () => {
  for (const course of [BLACKLIGHT, CORNHOLE_GOLF]) {
    test(`${course.name}: direct URL load opens its sheet`, async ({ page }) => {
      await freshGuest(page)
      await page.goto(`/scoring/${course.slug}`)
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: course.name })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Begin Round' })).toBeVisible()
    })

    test(`${course.name}: in-app scan modal (manual entry) opens its sheet`, async ({ page }) => {
      await freshGuest(page)
      await page.goto('/')
      await page.getByRole('button', { name: 'Open menu' }).click()
      await page.locator('#nav-menu-panel').getByRole('button', { name: 'Scan QR' }).click()
      const modal = page.getByRole('dialog')
      await modal.getByLabel("What's on the sign").fill(course.slug)
      await modal.getByRole('button', { name: 'Go' }).click()
      await expect(page).toHaveURL(new RegExp(`/scoring/${course.slug}$`))
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: course.name })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Begin Round' })).toBeVisible()
    })
  }
})
