import { test, expect, type Page } from '@playwright/test'
import { openTab } from './navMenuHelper'

// Covers the Map screen legend-color rework: not-visited pins render as real
// SVG shapes (star/circle/square/diamond) whose stroke traces the actual
// path outline in one continuous line -- unlike the earlier CSS clip-path/
// rotate approach, where a border on a clipped or rotated box only ever drew
// fragments of the original rectangle's edges and could leak color at the
// seams. A visited pin turns green with a checkmark replacing its number via
// a single fill swap on .map-pin-shape-fill, with nothing left over from a
// separate border layer to leak.
//
// The bingo-tile-count badge uses two offsets, chosen from real position
// data (not guessed): -11px is comfortable and collision-free for every
// category except Food & Store, where Granny Ann's Kitchen and Sugar Shack
// sit only ~30px apart at the map's max render width -- -11px there
// overlaps the NEIGHBORING diamond. -3px is the largest offset that stays
// clear of a neighbor across every food node pair (verified exhaustively
// using each category's actual painted geometry, not just its bounding
// box). Both offsets can still touch their OWN shape's corner -- an
// intentional trade-off, since overlapping a different node's pin is worse
// than sitting close to your own.
//
// Home Page is the true root route now, and the guest nav is a closed-by-
// default hamburger dropdown -- every test below opens it first via "Open
// menu" and selects Map via its menuitemradio role, per NavMenu.tsx.

async function openMapTab(page: Page): Promise<void> {
  await page.goto('/')
  await openTab(page, 'Map')
}

test.describe('Map pin legend colors', () => {
  test('not-visited pins render each category as a real SVG shape with the exact legend fill and legend number', async ({
    page,
  }) => {
    await openMapTab(page)

    const star = page.locator('.map-pin-attraction .map-pin-shape-fill').first()
    await expect(star).toHaveCSS('fill', 'rgb(255, 0, 0)')
    await expect(page.locator('.map-pin-attraction .map-pin-shape-text').first()).toHaveText(/^\d+$/)

    const circle = page.locator('.map-pin-animal .map-pin-shape-fill').first()
    await expect(circle).toHaveCSS('fill', 'rgb(255, 119, 0)')
    await expect(page.locator('.map-pin-animal .map-pin-shape-text').first()).toHaveText(/^\d+$/)

    const square = page.locator('.map-pin-service .map-pin-shape-fill').first()
    await expect(square).toHaveCSS('fill', 'rgb(234, 255, 0)')
    await expect(page.locator('.map-pin-service .map-pin-shape-text').first()).toHaveText(/^\d+$/)

    const diamond = page.locator('.map-pin-food .map-pin-shape-fill').first()
    await expect(diamond).toHaveCSS('fill', 'rgb(59, 120, 1)')
    await expect(page.locator('.map-pin-food .map-pin-shape-text').first()).toHaveText(/^\d+$/)

    // Every shape traces a real, continuous stroke (an actual SVG
    // <polygon>/<circle>/<rect> path, not a border on a clipped box). Star
    // pins use a thin black outline by design; every other shape is white.
    await expect(star).toHaveCSS('stroke', 'rgb(0, 0, 0)')
    await expect(star).toHaveCSS('stroke-width', '1px')
    for (const el of [circle, square, diamond]) {
      await expect(el).toHaveCSS('stroke', 'rgb(255, 255, 255)')
      await expect(el).toHaveCSS('stroke-width', '2px')
    }

    // Arcade Pad is legend number 1 among stars per the source image.
    await expect(page.locator('.map-pin[aria-label^="Arcade Pad"] .map-pin-shape-text')).toHaveText('1')
  })

  // LEGEND_NUMBER (MapScreen.tsx) is keyed by node name, so a node added in
  // the DB without a matching entry used to render a blank pin and an
  // unnumbered legend row (Cornhole Mini Golf, migration 043) -- and the
  // "first pin" checks above only caught it when that node happened to sort
  // first. This walks EVERY node in the four numbered legend categories.
  test('every legend-category node has a unique legend number, and its not-visited pin shows that number', async ({ page }) => {
    await openMapTab(page)
    await page.waitForSelector('.map-pin')

    for (const category of ['attraction', 'animal', 'service', 'food']) {
      const toggle = page.locator(`.map-legend-category-toggle[aria-controls="map-legend-list-${category}"]`)
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
      // The coming-soon building (migration 047) has the construction icon
      // instead of a number by design -- map-nodes-047.spec.ts covers it.
      const rows = await page.locator(`#map-legend-list-${category} > li:not([data-coming-soon])`).evaluateAll((lis) =>
        lis.map((li) => ({
          // The row's own text node is the node name (children are in a nested <ul>).
          name: [...li.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join('')
            .trim(),
          number: li.querySelector(':scope > .map-legend-item-number')?.textContent ?? null,
        })),
      )
      expect(rows.length, `${category} legend rows`).toBeGreaterThan(0)
      for (const row of rows) expect(row.number ?? '(none)', `legend number for ${row.name}`).toMatch(/^\d+$/)
      const numbers = rows.map((r) => r.number)
      expect(new Set(numbers).size, `${category} legend numbers are unique`).toBe(numbers.length)
      const legendNumber = new Map(rows.map((r) => [r.name, r.number]))

      const pins = await page.locator(`.map-pin.map-pin-${category}:not(.map-pin-coming-soon)`).evaluateAll((els) =>
        els.map((el) => ({
          name: (el.getAttribute('aria-label') ?? '').replace(/ \([^)]*\)$/, ''),
          text: el.querySelector('.map-pin-shape-text')?.textContent ?? '',
        })),
      )
      expect(pins.length, `${category} pins`).toBeGreaterThan(0)
      for (const pin of pins) {
        // Fresh device session, so nothing is visited; a staff-closed node
        // shows the lock instead of its number by design.
        if (pin.text === '\u{1F512}') continue
        expect(pin.text, `pin number for ${pin.name}`).toBe(legendNumber.get(pin.name))
      }
    }
  })

  test('visiting a node turns its pin green with a checkmark, and the badge is blue at the general -11px offset', async ({
    page,
  }) => {
    // Pedal Karts (not Arcade Pad -- that node is the subject of
    // map-parent-child.spec.ts's own visit-flow test, and both specs share
    // the same live demo data, so mutating a different node here keeps the
    // two files independent of run order).
    await openMapTab(page)

    const pin = page.locator('.map-pin[aria-label^="Pedal Karts"]')
    const fill = pin.locator('.map-pin-shape-fill')
    const text = pin.locator('.map-pin-shape-text')

    // Before: red star showing its legend number, no green anywhere.
    await expect(fill).toHaveCSS('fill', 'rgb(255, 0, 0)')

    await pin.click()
    await page.getByRole('button', { name: 'Mark Visited' }).click()
    await expect(page.getByText(/Did you complete .*Race the Pedal Karts.* here\?/)).toBeVisible()
    await page.getByRole('button', { name: 'No' }).click()

    await expect(fill).toHaveCSS('fill', 'rgb(34, 197, 94)')
    await expect(text).toHaveText('✓')
    // The green is distinct from the food-diamond dark green.
    await expect(fill).not.toHaveCSS('fill', 'rgb(59, 120, 1)')
    // Pedal Karts is a star -- stroke stays black regardless of visited
    // state (only the fill color changes when visited).
    await expect(fill).toHaveCSS('stroke', 'rgb(0, 0, 0)')

    const badge = pin.locator('.map-pin-tile-badge')
    await expect(badge).toHaveText('1')
    await expect(badge).toHaveCSS('background-color', 'rgb(59, 130, 246)')
    // Distinct from both the service-square yellow and the visited green.
    await expect(badge).not.toHaveCSS('background-color', 'rgb(234, 255, 0)')
    await expect(badge).not.toHaveCSS('background-color', 'rgb(34, 197, 94)')

    // Attraction (star) nodes use the general, more comfortable offset.
    await expect(badge).toHaveCSS('top', '-11px')
    await expect(badge).toHaveCSS('right', '-11px')
  })

  test('Food & Store badges use the tighter -3px offset', async ({ page }) => {
    await openMapTab(page)
    await page.waitForSelector('.map-pin-food')
    // Force a badge onto a food node the same way NodeDetailPopup would if
    // it had an uncompleted linked tile (no food node has one in seed data).
    await page.evaluate(() => {
      const pin = document.querySelector('.map-pin-food')
      const span = document.createElement('span')
      span.className = 'map-pin-tile-badge'
      span.textContent = '1'
      pin?.prepend(span)
    })
    const badge = page.locator('.map-pin-food .map-pin-tile-badge').first()
    await expect(badge).toHaveCSS('top', '-3px')
    await expect(badge).toHaveCSS('right', '-3px')
  })

  test('a badge never overlaps a different node\'s shape, even in the tightest real cluster', async ({ page }) => {
    // Food & Store nodes have zero linked bingo tiles in the current seed
    // data, so they never show a real badge -- inject one on every food pin
    // to test the geometry itself, not today's data.
    await openMapTab(page)
    await page.evaluate(() => {
      document.querySelectorAll('.map-pin-food').forEach((pin) => {
        const span = document.createElement('span')
        span.className = 'map-pin-tile-badge'
        span.textContent = '9'
        pin.prepend(span)
      })
    })

    const pins = await page.locator('.map-pin-food').all()
    const nodes = []
    for (const pin of pins) {
      const label = await pin.getAttribute('aria-label')
      const shapeBox = await pin.locator('.map-pin-shape').boundingBox()
      const badgeBox = await pin.locator('.map-pin-tile-badge').boundingBox()
      if (!shapeBox || !badgeBox) throw new Error(`missing box for ${label}`)
      const center = { x: shapeBox.x + shapeBox.width / 2, y: shapeBox.y + shapeBox.height / 2 }
      nodes.push({ label, center, badgeBox })
    }

    // Diamond fill: |dx| + |dy| <= 15 around the shape's own center (the
    // SVG diamond's points touch each edge's midpoint of its 30x30
    // viewBox). Sample the badge rect on a grid and check whether any
    // sampled point falls inside a NEIGHBOR's diamond.
    function insideDiamond(dx: number, dy: number) {
      return Math.abs(dx) + Math.abs(dy) <= 15
    }

    for (const node of nodes) {
      for (const other of nodes) {
        if (other.label === node.label) continue
        const steps = 6
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; j <= steps; j++) {
            const px = node.badgeBox.x + (node.badgeBox.width * i) / steps
            const py = node.badgeBox.y + (node.badgeBox.height * j) / steps
            const inside = insideDiamond(px - other.center.x, py - other.center.y)
            expect(inside, `${node.label}'s badge should not touch ${other.label}'s diamond`).toBe(false)
          }
        }
      }
    }
  })
})
