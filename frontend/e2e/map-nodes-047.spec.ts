import { test, expect, type Page } from '@playwright/test'
import { withSession } from './deviceSessionHelper'

// Migration 047's map changes: Cornhole Mini Golf moved to the bottom-right
// corner, the old Tractor Ride renamed "Tractor Ride - West" with a new
// "Tractor Ride - East", a new Bee Maze, and a coming-soon building
// (map_nodes.coming_soon) that shows a construction icon and can't be
// visited. Hits the real dev project, no mocking.

const API = 'http://localhost:8000'
const BUILDING = 'New Building (Coming Soon)'
const CHANGED_PINS = ['Cornhole Mini Golf', 'Tractor Ride - West', 'Tractor Ride - East', 'Bee Maze', BUILDING]

interface MapNodeRow {
  id: string
  name: string
  category: string
  is_open: boolean
  coming_soon: boolean
  x_pct: number | null
  y_pct: number | null
  parent_node_id: string | null
}

async function openMap(page: Page): Promise<void> {
  await page.goto('/map')
  await page.waitForSelector('.map-pin')
}

function pin(page: Page, name: string) {
  return page.locator(`.map-pin[aria-label^="${name} ("]`)
}

interface Box {
  name: string
  l: number
  t: number
  r: number
  b: number
}

// Every pin's shape box (and badge, if it has one) relative to the image.
async function pinGeometry(page: Page) {
  return page.evaluate(() => {
    const img = document.querySelector('.map-image')!.getBoundingClientRect()
    const toBox = (name: string, r: DOMRect) => ({ name, l: r.left, t: r.top, r: r.right, b: r.bottom })
    return {
      img: toBox('image', img),
      pins: [...document.querySelectorAll('.map-pin')].map((el) => {
        const name = (el.getAttribute('aria-label') ?? '').replace(/ \([^)]*\)$/, '')
        const badge = el.querySelector('.map-pin-tile-badge')
        return {
          shape: toBox(name, el.querySelector('.map-pin-shape')!.getBoundingClientRect()),
          badge: badge ? toBox(name, badge.getBoundingClientRect()) : null,
        }
      }),
    }
  })
}

const inside = (box: Box, img: Box) => box.l >= img.l - 0.5 && box.t >= img.t - 0.5 && box.r <= img.r + 0.5 && box.b <= img.b + 0.5
const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

test.describe('Map nodes (migration 047)', () => {
  test('both tractor stations exist, West is the original pin and East is the new one at the far right', async ({ request }) => {
    const rows = (await (await request.get(`${API}/map/nodes`, withSession(crypto.randomUUID()))).json()) as MapNodeRow[]
    expect(rows.find((r) => r.name === 'Tractor Ride')).toBeUndefined()
    const west = rows.find((r) => r.name === 'Tractor Ride - West')!
    const east = rows.find((r) => r.name === 'Tractor Ride - East')!
    expect([west.x_pct, west.y_pct]).toEqual([10.5, 23.1])
    expect([east.x_pct, east.y_pct]).toEqual([92.6, 86.4])
    expect(west.x_pct!).toBeLessThan(east.x_pct!)
    expect(east.category).toBe(west.category)
    expect(rows.find((r) => r.name === 'Bee Maze')).toMatchObject({ category: 'attraction', x_pct: 71.4, y_pct: 52.9 })
    expect(rows.find((r) => r.name === 'Cornhole Mini Golf')).toMatchObject({ x_pct: 87.7, y_pct: 97.3 })
    expect(rows.find((r) => r.name === BUILDING)).toMatchObject({ x_pct: 43.9, y_pct: 77.2, is_open: false, coming_soon: true })
  })

  test('the tractor stations, Bee Maze and Cornhole Mini Golf have their own legend numbers', async ({ page }) => {
    await openMap(page)
    await expect(pin(page, 'Tractor Ride - West').locator('.map-pin-shape-text')).toHaveText('3')
    await expect(pin(page, 'Tractor Ride - East').locator('.map-pin-shape-text')).toHaveText('20')
    await expect(pin(page, 'Bee Maze').locator('.map-pin-shape-text')).toHaveText('21')
    await expect(pin(page, 'Cornhole Mini Golf').locator('.map-pin-shape-text')).toHaveText('19')

    // Attraction numbers run 1..21 with no gaps or repeats.
    await page.locator('.map-legend-category-toggle[aria-controls="map-legend-list-attraction"]').click()
    const numbers = await page.locator('#map-legend-list-attraction > li > .map-legend-item-number').allTextContents()
    expect(numbers.map(Number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
  })

  test('the coming-soon building shows a construction icon, has no Mark Visited and no number, and the API refuses a visit', async ({
    page,
    request,
  }) => {
    await openMap(page)
    const building = pin(page, BUILDING)
    await expect(building).toHaveClass(/map-pin-coming-soon/)
    await expect(building).toHaveAttribute('aria-label', `${BUILDING} (Service, coming soon)`)
    await expect(building.locator('.map-pin-shape-text')).toHaveText('\u{1F6A7}')
    await expect(building.locator('.map-pin-tile-badge')).toHaveCount(0)

    await building.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Under construction. Coming soon.')).toBeVisible()
    await expect(dialog.getByText('Coming soon. Not open yet.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Mark Visited|Check In Again/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()

    await page.locator('.map-legend-category-toggle[aria-controls="map-legend-list-service"]').click()
    const row = page.locator('#map-legend-list-service > li[data-coming-soon]')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(`${BUILDING} (Coming soon)`)

    const rows = (await (await request.get(`${API}/map/nodes`, withSession(crypto.randomUUID()))).json()) as MapNodeRow[]
    const id = rows.find((r) => r.name === BUILDING)!.id
    const res = await request.post(`${API}/map/nodes/${id}/visit`, {
      ...withSession(crypto.randomUUID()),
      data: { completed_tile_ids: [] },
    })
    expect(res.status()).toBe(409)
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    test(`at ${viewport.width} px every pin is inside the map image and the changed pins overlap nothing`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await openMap(page)
      const { img, pins } = await pinGeometry(page)
      for (const p of pins) {
        expect(inside(p.shape, img), `${p.shape.name} pin inside the image`).toBe(true)
        if (p.badge) expect(inside(p.badge, img), `${p.badge.name} badge inside the image`).toBe(true)
      }
      // Only the pins this migration touched: a few existing pins (the food
      // cluster, and more at phone width) already sit closer than one pin.
      for (const name of CHANGED_PINS) {
        const mine = pins.find((p) => p.shape.name === name)
        expect(mine, `${name} has a pin`).toBeDefined()
        for (const other of pins) {
          if (other === mine) continue
          expect(overlaps(mine!.shape, other.shape), `${name} overlaps ${other.shape.name}`).toBe(false)
        }
      }
    })
  }

  test('the legend lists every pin, and every numbered pin has a legend row with the same number', async ({ page }) => {
    await openMap(page)
    const pins = await page.locator('.map-pin').evaluateAll((els) =>
      els.map((el) => ({
        name: (el.getAttribute('aria-label') ?? '').replace(/ \([^)]*\)$/, ''),
        text: el.querySelector('.map-pin-shape-text')?.textContent ?? '',
      })),
    )
    const legend = new Map<string, string | null>()
    for (const category of ['attraction', 'animal', 'service', 'food']) {
      await page.locator(`.map-legend-category-toggle[aria-controls="map-legend-list-${category}"]`).click()
      const rows = await page.locator(`#map-legend-list-${category} > li`).evaluateAll((lis) =>
        lis.map((li) => ({
          name: [...li.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join('')
            .trim(),
          number: li.querySelector(':scope > .map-legend-item-number')?.textContent ?? null,
        })),
      )
      for (const row of rows) legend.set(row.name, row.number)
    }
    for (const p of pins) {
      expect(legend.has(p.name), `legend row for ${p.name}`).toBe(true)
      if (/^\d+$/.test(p.text)) expect(legend.get(p.name), `legend number for ${p.name}`).toBe(p.text)
    }
  })
})
