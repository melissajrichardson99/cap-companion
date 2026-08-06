import { test, expect, type Locator, type Page } from '@playwright/test'

// Covers the Scoring Sheet (Plan.md 2.2): game listing, running score
// accuracy across multiple entries, and automatic win detection for each of
// the three win-condition shapes -- including the two confirmed tie rules
// that must NOT be flattened to "first to a flat number": Horse Hoops'
// bonus round on a tie, and Tiki Toss' round-based multi-way tiebreak.
// Hits the real dev Supabase project via the backend, same as the other e2e
// specs -- no mocking.

function gameCard(page: Page, gameName: string): Locator {
  // "Cornhole" is a substring of "Cornhole Extreme", so hasText alone is
  // ambiguous -- scope to the card whose *exact* heading matches.
  return page.locator('.scoring-game-card').filter({ has: page.getByRole('heading', { name: gameName, exact: true }) })
}

async function openGame(page: Page, gameName: string): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Scoring Sheet' }).click()
  await gameCard(page, gameName).getByRole('button', { name: 'Start Scoring' }).click()
  return page.getByRole('dialog')
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

function playerRow(dialog: Locator, playerName: string): Locator {
  return dialog.locator('.scoring-player-row', { hasText: playerName })
}

async function score(dialog: Locator, playerName: string, eventButtonName: string, times = 1): Promise<void> {
  const button = playerRow(dialog, playerName).getByRole('button', { name: eventButtonName, exact: true })
  for (let i = 0; i < times; i++) {
    await button.click()
  }
}

test.describe('Scoring Sheet', () => {
  test('lists all 5 documented games with their rules and win conditions, Mini Golf/Archery excluded', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Scoring Sheet' }).click()

    for (const name of ['Farm Toss', 'Horse Hoops', 'Cornhole', 'Cornhole Extreme', 'Tiki Toss / Ring & Hook']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }

    await expect(page.getByRole('heading', { name: 'Mini Golf', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Archery', exact: true })).toHaveCount(0)

    await expect(gameCard(page, 'Farm Toss').getByText('First to 21 wins.')).toBeVisible()
  })

  test('Farm Toss: running totals stay accurate across multiple entries, first_to win fires on overshoot', async ({
    page,
  }) => {
    const dialog = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Alice'])

    const total = () => playerRow(dialog, 'Alice').locator('.scoring-player-total')
    await expect(total()).toHaveText('0')

    await score(dialog, 'Alice', '6-Point Ring (+6)')
    await expect(total()).toHaveText('6')
    await expect(dialog.getByText('Last: +6 for Alice — 6-Point Ring')).toBeVisible()

    await score(dialog, 'Alice', '6-Point Ring (+6)')
    await expect(total()).toHaveText('12')

    await score(dialog, 'Alice', '3-Point Ring (+3)')
    await expect(total()).toHaveText('15')

    // 15 + 6 = 21 exactly -- clean win, no overshoot needed here.
    await score(dialog, 'Alice', '6-Point Ring (+6)')

    await expect(dialog.locator('.scoring-win-headline')).toContainText('Alice wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Alice' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('21')
  })

  test('Farm Toss: reaching the threshold in one overshooting entry still wins immediately', async ({ page }) => {
    const dialog = await openGame(page, 'Farm Toss')
    await beginSession(dialog, ['Bob'])

    await score(dialog, 'Bob', '6-Point Ring (+6)', 3) // 18
    await score(dialog, 'Bob', '6-Point Ring (+6)') // 24 -- overshoots 21 on the last throw

    await expect(dialog.locator('.scoring-win-headline')).toContainText('Bob wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Bob' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('24')
  })

  test('Horse Hoops: a tie at the threshold triggers a bonus round instead of declaring a winner', async ({
    page,
  }) => {
    const dialog = await openGame(page, 'Horse Hoops')
    await beginSession(dialog, ['Red Team', 'Blue Team'])

    // Red Team: 4 + 4 + 2 = 10
    await score(dialog, 'Red Team', 'Red Horse Neck (+4)', 2)
    await score(dialog, 'Red Team', 'Blue Horse Neck (+2)')
    // Blue Team: 3 + 3 + 2 + 1 + 1 = 10 -- exact tie with Red Team
    await score(dialog, 'Blue Team', 'Yellow Horse Neck (+3)', 2)
    await score(dialog, 'Blue Team', 'Blue Horse Neck (+2)')
    await score(dialog, 'Blue Team', 'Hit Horse (+1)', 2)

    await expect(playerRow(dialog, 'Red Team').locator('.scoring-player-total')).toHaveText('10')
    await expect(playerRow(dialog, 'Blue Team').locator('.scoring-player-total')).toHaveText('10')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Tied at 10')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Red Team')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Blue Team')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('bonus round')

    // Sudden death: the very next point, however small, wins it outright --
    // but only provisionally: a bonus-round win doesn't auto-finish the
    // session (see autoFinishesOnWin), since a real tally can't be sure
    // play is over just because one entry landed. Staff confirms with an
    // explicit "Finish Game" tap.
    await score(dialog, 'Red Team', 'Hit Horse (+1)')

    await expect(dialog.locator('.scoring-provisional-win-text')).toContainText('Red Team leads with 11')
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Finish Game' }).click()

    await expect(dialog.locator('.scoring-win-headline')).toContainText('Red Team wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Red Team' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('11')
  })

  test('Horse Hoops: no bonus round when one team reaches 10 clear of the other', async ({ page }) => {
    const dialog = await openGame(page, 'Horse Hoops')
    await beginSession(dialog, ['Green Team', 'Gold Team'])

    await score(dialog, 'Gold Team', 'Hit Horse (+1)', 3) // Gold Team at 3, well behind
    await score(dialog, 'Green Team', 'Red Horse Neck (+4)', 2) // 8
    await score(dialog, 'Green Team', 'Blue Horse Neck (+2)') // 10, clear of Gold Team's 3

    await expect(dialog.locator('.scoring-tie-banner')).toHaveCount(0)
    await expect(dialog.locator('.scoring-provisional-win-text')).toContainText('Green Team leads with 10')
    await dialog.getByRole('button', { name: 'Finish Game' }).click()

    await expect(dialog.locator('.scoring-win-headline')).toContainText('Green Team wins!')
    await expect(dialog.locator('.scoring-tie-banner')).toHaveCount(0)
  })

  test('Tiki Toss: a multi-throw round tie stays pending, then resolves once someone wins a later round', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const dialog = await openGame(page, 'Tiki Toss / Ring & Hook')
    await beginSession(dialog, ['Alice', 'Bob'])

    // Round 1: both throw all Bimini (5 x 10 = 50) -- below the 100
    // threshold, so this must NOT trigger any win/tie state yet.
    await score(dialog, 'Alice', 'Bimini (+5)', 10)
    await score(dialog, 'Bob', 'Bimini (+5)', 10)
    await expect(dialog.locator('.scoring-tie-banner')).toHaveCount(0)
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)
    await expect(playerRow(dialog, 'Alice').locator('.scoring-player-total')).toHaveText('50')
    await expect(playerRow(dialog, 'Bob').locator('.scoring-player-total')).toHaveText('50')

    // Round 2: both throw all Bimini again -- both land on exactly 100 at
    // the same round boundary. Per the confirmed rule ("highest score wins
    // if multiple reach 100 same round"), an exact tie must NOT declare a
    // winner -- it stays pending into another round.
    await score(dialog, 'Alice', 'Bimini (+5)', 10)
    await score(dialog, 'Bob', 'Bimini (+5)', 10)

    await expect(playerRow(dialog, 'Alice').locator('.scoring-player-total')).toHaveText('100')
    await expect(playerRow(dialog, 'Bob').locator('.scoring-player-total')).toHaveText('100')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Tied after round 2')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Alice')
    await expect(dialog.locator('.scoring-tie-banner')).toContainText('Bob')
    await expect(dialog.locator('.scoring-win-headline')).toHaveCount(0)

    // Round 3 (the tiebreak round): Alice keeps throwing Bimini (+50, total
    // 150), Bob throws the lower-value Nassau instead (+30, total 130).
    // Alice pulls strictly ahead at this round's boundary and wins the game
    // outright -- "someone wins a round" per the confirmed rule.
    await score(dialog, 'Alice', 'Bimini (+5)', 10)
    await score(dialog, 'Bob', 'Nassau (+3)', 10)

    await expect(dialog.locator('.scoring-win-headline')).toContainText('Alice wins!')
    const finalRow = dialog.locator('tr', { hasText: 'Alice' })
    await expect(finalRow.locator('.scoring-final-totals-score')).toHaveText('150')
  })

  test('finishing a session offers a downloadable plain-text summary with the score log', async ({ page }) => {
    const dialog = await openGame(page, 'Cornhole')
    await beginSession(dialog, ['Casey'])

    await score(dialog, 'Casey', 'Cornhole (+3)', 7) // 21 exactly
    await expect(dialog.locator('.scoring-win-headline')).toContainText('Casey wins!')

    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download Summary' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('cornhole-score-sheet.txt')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const text = Buffer.concat(chunks).toString('utf-8')

    expect(text).toContain("Cobb's Adventure Park — Cornhole")
    expect(text).toContain('Casey: 21')
    expect(text).toContain('Winner: Casey')
    expect(text).toContain('Casey — Cornhole (+3)')
    expect(text.match(/Casey — Cornhole \(\+3\)/g)).toHaveLength(7)
  })
})
