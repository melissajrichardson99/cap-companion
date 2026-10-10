import { expect, type Frame, type Page } from '@playwright/test'

// Drives MinigameOverlay the same way the Godot games do: by posting messages
// from inside the iframe to window.parent. The overlay checks event.source
// against its own iframe, so these have to be posted from the frame itself,
// not from the page. Godot's canvas buttons (Play Again, Exit, the X) have no
// DOM, so this is the only way e2e can reach them.
//
// Message contract (see MinigameOverlay.tsx):
//   minigame-hello    -- a build that reports results announces itself (new
//                        builds post this from an inline <head> script)
//   minigame-result   -- a round ended; the overlay stays open on the end card
//   minigame-complete -- the guest tapped Exit or the X; the overlay closes

export interface MinigameResultMessage {
  outcome: 'win' | 'lose' | 'timeup' | 'finished'
  stats?: Record<string, number>
}

export async function minigameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('.minigame-overlay-frame').elementHandle()
  const frame = await handle?.contentFrame()
  if (!frame) throw new Error('No minigame iframe is mounted')
  return frame
}

export async function postFromMinigame(page: Page, ...messages: Record<string, unknown>[]): Promise<void> {
  const frame = await minigameFrame(page)
  // One evaluate for all messages, so several posts land back to back in the
  // same task -- before React gets a chance to re-render in between.
  await frame.evaluate((msgs) => {
    for (const m of msgs) window.parent.postMessage(m, '*')
  }, messages)
}

// Simulates a build that sends results, even when the build actually served
// is an old one. Harmless to send twice (real new builds also send it).
export async function announceResultSupport(page: Page): Promise<void> {
  await postFromMinigame(page, { type: 'minigame-hello' })
}

export async function postMinigameResult(page: Page, result: MinigameResultMessage): Promise<void> {
  await postFromMinigame(page, { type: 'minigame-result', ...result })
  await expect(page.locator('.minigame-overlay')).toHaveAttribute('data-minigame-outcome', result.outcome)
}

export async function dismissMinigameOverlay(page: Page): Promise<void> {
  await postFromMinigame(page, { type: 'minigame-complete' })
  await expect(page.locator('.minigame-overlay')).toHaveCount(0)
}

// Serves /games/<slug>/index.html with the inline hello script removed, so a
// new build looks like an old one that never reports results.
export async function serveAsLegacyBuild(page: Page, slug: string): Promise<void> {
  await page.route(`**/games/${slug}/index.html`, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(/<script id="?cap-minigame-hello"?>[\s\S]*?<\/script>/, '')
    await route.fulfill({ response, body })
  })
}
