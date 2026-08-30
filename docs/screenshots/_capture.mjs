// Standalone screenshot capture script for the portfolio README.
// NOT part of the checked-in e2e suite (frontend/e2e/) -- ad hoc, run manually.
// Assumes the backend (uvicorn, port 8000) and frontend (vite, port 5173) dev
// servers are already running locally, same as frontend/playwright.config.ts's
// webServer setup, and that backend/scripts/reset_demo_data.py has been run
// recently for clean state.
//
// Usage:  node docs/screenshots/_capture.mjs
// Output: docs/screenshots/*.png

import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = 'C:\\Users\\Melissa\\Cobbs\\cap-companion\\docs\\screenshots'
const BASE = 'http://localhost:5173'
const API = 'http://localhost:8000'

function readStaffPassword() {
  const backendEnvPath = 'C:\\Users\\Melissa\\Cobbs\\cap-companion\\backend\\.env'
  const contents = readFileSync(backendEnvPath, 'utf-8')
  const match = contents.match(/^STAFF_PASSWORD=(.*)$/m)
  if (!match || !match[1]) throw new Error('STAFF_PASSWORD not found in backend/.env')
  return match[1].trim()
}

function withSession(token) {
  return { headers: { 'X-Device-Session': token } }
}

async function seedDeviceSession(page, token) {
  await page.addInitScript((t) => {
    localStorage.setItem('cap-device-session-id', t)
  }, token)
}

// Earns enough Cobb Coins (via raw API, same approach as
// frontend/e2e/collectible-cards.spec.ts's earnEnoughForOnePurchase) to buy
// one Collectible Card without playing through any minigames manually.
async function earnEnoughForOnePurchase(request, token) {
  const cardsRes = await request.get(`${API}/bingo/cards`)
  const cards = await cardsRes.json()
  const cardId = cards[0].id
  const cardRes = await request.get(`${API}/bingo/card/${cardId}`, withSession(token))
  const card = await cardRes.json()
  for (const tile of card.tiles) {
    await request.post(`${API}/bingo/tiles/${tile.id}/complete`, withSession(token))
  }
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const request = context.request

  const results = { ok: [], skipped: [] }

  // 1. Home page
  try {
    await page.goto(`${BASE}/`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: path.join(OUT_DIR, 'home.png') })
    results.ok.push('home.png')
  } catch (e) {
    results.skipped.push(`home.png -- ${e.message}`)
  }

  // 2. Interactive Map
  try {
    await page.goto(`${BASE}/map`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT_DIR, 'map.png') })
    results.ok.push('map.png')
  } catch (e) {
    results.skipped.push(`map.png -- ${e.message}`)
  }

  // 3. Bingo card
  try {
    await page.goto(`${BASE}/bingo`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT_DIR, 'bingo.png') })
    results.ok.push('bingo.png')
  } catch (e) {
    results.skipped.push(`bingo.png -- ${e.message}`)
  }

  // 4. Collectible card reveal -- earn coins via raw API (same pattern as
  // collectible-cards.spec.ts), then drive the real purchase UI to the
  // "You collected a new card!" reveal dialog.
  try {
    const token = crypto.randomUUID()
    await request.post(`${API}/session/reset`, withSession(token))
    await seedDeviceSession(page, token)
    await earnEnoughForOnePurchase(request, token)

    await page.goto(`${BASE}/`)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Collectibles' }).click()
    const shopCard = page.locator('.collectible-shop-card', { hasText: 'Capybara' })
    await shopCard.getByRole('button', { name: 'Collect' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/collecting this one/i).fill('Alex')
    await dialog.getByRole('button', { name: 'Collect', exact: true }).click()
    await dialog.getByText('You collected a new card!').waitFor()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT_DIR, 'collectible-card.png') })
    results.ok.push('collectible-card.png')
  } catch (e) {
    results.skipped.push(`collectible-card.png -- ${e.message}`)
  }

  // 5. Staff Analytics dashboard
  try {
    const staffPage = await context.newPage()
    await staffPage.goto(`${BASE}/staff`)
    await staffPage.getByLabel('Password').fill(readStaffPassword())
    await staffPage.getByRole('button', { name: 'Log In' }).click()
    await staffPage.getByRole('tab', { name: 'Photo Queue' }).waitFor()
    await staffPage.getByRole('tab', { name: 'Analytics' }).click()
    await staffPage.getByRole('button', { name: '7D' }).click()
    const totalUsersValue = staffPage
      .locator('.staff-analytics-stat-card', { hasText: 'Total App Users' })
      .locator('.staff-analytics-stat-value')
    await totalUsersValue.waitFor({ timeout: 30_000 })
    await staffPage.waitForTimeout(500)
    await staffPage.screenshot({ path: path.join(OUT_DIR, 'staff-analytics.png') })
    results.ok.push('staff-analytics.png')
    await staffPage.close()
  } catch (e) {
    results.skipped.push(`staff-analytics.png -- ${e.message}`)
  }

  await browser.close()

  console.log('OK:', results.ok)
  console.log('SKIPPED:', results.skipped)
}

main()
