import { expect, type Locator, type Page } from '@playwright/test'

// Shared phone-width layout checks for the Staff screens
// (staff-photo-queue-layout.spec.ts, staff-responsive.spec.ts).
//
// .staff-page clips overflow (StaffPage.css), so content that's too wide is
// cut off without making the document scroll sideways -- a
// documentElement.scrollWidth check alone passes while a button is
// unreachable. These helpers check real element boxes and hit-testing
// instead.

// The page never scrolls sideways, and no element inside .staff-page runs
// past the viewport's right edge (where .staff-page's clip would hide it).
// Element boxes, not .staff-page's scrollWidth: its decorative leaf
// ::before hangs past the edge on purpose and inflates scrollWidth.
// Descendants of a horizontal scroll container (e.g. a table wrapper) are
// fine as long as the container itself fits.
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const overflowing: string[] = []
    for (const el of document.querySelectorAll('.staff-page *, .staff-login-screen *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.right <= vw + 0.5) continue
      let scrolls = false
      for (let p = el.parentElement; p && !p.classList.contains('staff-page'); p = p.parentElement) {
        const o = getComputedStyle(p).overflowX
        if ((o === 'auto' || o === 'scroll') && p.getBoundingClientRect().right <= vw + 0.5) scrolls = true
      }
      if (!scrolls) overflowing.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)}`)
    }
    return { doc: document.documentElement.scrollWidth, vw, overflowing: overflowing.slice(0, 5) }
  })
  expect(result.doc, 'document scrolls sideways').toBeLessThanOrEqual(result.vw)
  expect(result.overflowing, 'elements cut off past the right edge').toEqual([])
}

// Scrolls the window (vertically only -- scrollIntoView would also scroll
// .staff-page sideways and hide exactly the bug being tested for) so the
// control is mid-screen, then checks it's inside the viewport and that the
// topmost element at its left edge, centre and right edge is the control
// itself (not the fixed sidebar rail, another card, or nothing).
export async function expectControlReachable(control: Locator, minHeight = 44): Promise<void> {
  await expect(control).toBeVisible()
  const result = await control.evaluate((el) => {
    const isFixed = (() => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        if (getComputedStyle(e).position === 'fixed') return true
      }
      return false
    })()
    if (isFixed) {
      el.scrollIntoView({ block: 'nearest' })
    } else {
      window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight / 2)
    }
    const r = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const cy = r.top + r.height / 2
    const covered: string[] = []
    for (const x of [r.left + 3, r.left + r.width / 2, r.right - 3]) {
      const hit = x >= 0 && x < vw && cy >= 0 && cy < window.innerHeight ? document.elementFromPoint(x, cy) : null
      const label = el.closest('label')
      if (!hit || !(hit === el || el.contains(hit) || (label && label.contains(hit)))) {
        covered.push(`${Math.round(x)}:${hit ? hit.className || hit.tagName : 'outside viewport'}`)
      }
    }
    return { left: r.left, right: r.right, height: r.height, vw, covered }
  })
  const name = (await control.getAttribute('aria-label')) ?? (await control.innerText()).trim()
  expect(result.left, `"${name}" starts left of the viewport`).toBeGreaterThanOrEqual(0)
  expect(result.right, `"${name}" ends right of the viewport`).toBeLessThanOrEqual(result.vw)
  expect(result.covered, `"${name}" is covered or off-screen at`).toEqual([])
  if (minHeight > 0) expect(result.height, `"${name}" tap target height`).toBeGreaterThanOrEqual(minHeight - 0.5)
}
