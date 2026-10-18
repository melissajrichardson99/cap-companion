import { deflateSync, crc32 } from 'node:zlib'
import { test, expect, type Page } from '@playwright/test'
import { loginAsStaff } from './staffAuthHelper'
import { expectControlReachable, expectNoHorizontalOverflow } from './layoutHelper'

// Layout regression for the Staff photo lists (pending queue, shortlisted,
// animal photos): with images of every shape, at phone and desktop widths,
// every action button in every row is on-screen, unobstructed and at least
// ~44px tall. Before the fix, Approve/Reject/Delete didn't wrap and
// .staff-page's overflow:hidden silently clipped Delete off the right edge
// at 320-360px.
//
// The photo lists are served from page.route (browser-side only) rather
// than real uploads: the upload endpoint now shrinks every image to 1600px,
// so a full-size pre-shrink photo can't be created through it, and this
// way the spec writes nothing to the dev database or storage, so there's
// nothing to clean up. The images themselves are real PNGs at the stated
// pixel sizes. The real-data flows stay covered by staff-page.spec.ts,
// staff-shortlisted-photos.spec.ts and staff-animal-photos.spec.ts.

const SHAPES: Record<string, [number, number]> = {
  'portrait-3x4': [900, 1200],
  'portrait-9x16': [900, 1600],
  landscape: [1600, 1067],
  panorama: [4000, 500],
  square: [1000, 1000],
  tiny: [16, 12],
  'full-size-4032x3024': [4032, 3024],
  'full-size-portrait-3024x4032': [3024, 4032],
}

const WIDTHS: [number, number][] = [
  [360, 740],
  [390, 844],
  [1280, 800],
]

const IMAGE_ORIGIN = 'http://layout-test.invalid'

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// Minimal RGB PNG with a diagonal stripe so a wrong crop is visible in a
// screenshot -- just enough of an encoder for real pixel dimensions.
function makePng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  const rowLength = 1 + width * 3
  const raw = Buffer.alloc(rowLength * height)
  for (let y = 0; y < height; y++) {
    const stripe = Math.floor((y / height) * width)
    for (let x = 0; x < width; x++) {
      const i = y * rowLength + 1 + x * 3
      const onStripe = Math.abs(x - stripe) < Math.max(1, width / 40)
      raw[i] = onStripe ? 255 : 80
      raw[i + 1] = onStripe ? 255 : 140
      raw[i + 2] = onStripe ? 255 : 200
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PNGS = new Map<string, Buffer>()

function photoRow(shape: string, i: number, status: 'pending_review' | 'shortlisted') {
  return {
    id: `00000000-0000-4000-8000-${String(i + (status === 'shortlisted' ? 100 : 0)).padStart(12, '0')}`,
    guest_label: `Layout ${shape}`,
    email: 'a.rather.long.staff.reference.address@example-photo-domain.com',
    photo_url: `${IMAGE_ORIGIN}/${shape}.png`,
    submitted_at: new Date().toISOString(),
    status,
    vote_count: i,
    voted_by_me: false,
  }
}

async function mockPhotoLists(page: Page) {
  const shapes = Object.keys(SHAPES)
  await page.route(`${IMAGE_ORIGIN}/*.png`, (route) => {
    const shape = new URL(route.request().url()).pathname.slice(1, -'.png'.length)
    return route.fulfill({ contentType: 'image/png', body: PNGS.get(shape)! })
  })
  await page.route('**/photos/pending', (route) =>
    route.fulfill({ json: shapes.map((s, i) => photoRow(s, i, 'pending_review')) }),
  )
  await page.route('**/photos/shortlisted', (route) =>
    route.fulfill({ json: shapes.map((s, i) => photoRow(s, i, 'shortlisted')) }),
  )
  // Staff Page's animal picker opens on ANIMALS[0] (Capybara).
  await page.route('**/animal-photos', (route) =>
    route.fulfill({
      json: shapes.map((s, i) => ({
        id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
        animal_slug: 'capybara',
        photo_url: `${IMAGE_ORIGIN}/${s}.png`,
        display_order: i,
      })),
    }),
  )
}

// Every thumbnail actually loaded at its real pixel size and still renders
// as the fixed 56px box (58px with its border) -- a huge image never
// pushes the row taller.
async function expectThumbsLoadedAndBoxed(page: Page, rowSelector: string) {
  const thumbs = page.locator(`${rowSelector} img.staff-photo-thumb`)
  await expect(thumbs).toHaveCount(Object.keys(SHAPES).length)
  for (const thumb of await thumbs.all()) {
    await thumb.scrollIntoViewIfNeeded()
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    const box = (await thumb.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(60)
    expect(box.height).toBeLessThanOrEqual(60)
  }
  const natural = await thumbs.evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).map((img) => `${img.naturalWidth}x${img.naturalHeight}`),
  )
  expect(natural).toEqual(Object.values(SHAPES).map(([w, h]) => `${w}x${h}`))
}

async function expectRowActionsReachable(page: Page, rowSelector: string) {
  const rows = page.locator(rowSelector)
  await expect(rows).toHaveCount(Object.keys(SHAPES).length)
  for (const row of await rows.all()) {
    const buttons = row.locator('.staff-photo-actions button')
    expect(await buttons.count()).toBeGreaterThan(0)
    for (const button of await buttons.all()) {
      await expectControlReachable(button)
    }
  }
}

test.beforeAll(() => {
  for (const [shape, [w, h]] of Object.entries(SHAPES)) PNGS.set(shape, makePng(w, h))
})

for (const [width, height] of WIDTHS) {
  test(`photo action buttons stay on-screen and tappable for every image shape at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height })
    await mockPhotoLists(page)
    // Never let a stray click reach the real API with a fake id.
    await page.route(/\/photos\/[0-9a-f-]{36}\/(shortlist|reject)$/, (route) => route.abort())
    await loginAsStaff(page)

    // Pending queue + Shortlisted (both on the Photo Queue tab).
    await expect(page.locator('.staff-photo-row').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectThumbsLoadedAndBoxed(page, '.staff-photo-row')
    await expectThumbsLoadedAndBoxed(page, '.staff-shortlisted-row')
    await expectRowActionsReachable(page, '.staff-photo-row')
    await expectRowActionsReachable(page, '.staff-shortlisted-row')
    await expectControlReachable(page.getByRole('button', { name: /^Clear All/ }))

    // Animal Photos manager (same row/thumbnail classes).
    await page.getByRole('tab', { name: 'Animal Photos' }).click()
    await expect(page.locator('.staff-photo-row').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectThumbsLoadedAndBoxed(page, '.staff-photo-row')
    await expectRowActionsReachable(page, '.staff-photo-row')
  })
}
